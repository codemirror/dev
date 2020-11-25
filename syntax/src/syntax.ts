import {Tree, SyntaxNode, ChangedRange, TreeFragment, NodePropSource} from "lezer-tree"
// NOTE: This package should only use _types_ from "lezer", to avoid
// pulling in that dependency when no actual Lezer-based parser is used.
import {Input, IncrementalParser, IncrementalParse} from "lezer"
import {Text, TextIterator} from "@codemirror/next/text"
import {EditorState, StateField, Transaction, Syntax, Extension, StateEffect, StateEffectType,
        Facet, languageDataProp, ChangeDesc} from "@codemirror/next/state"
import {ViewPlugin, ViewUpdate, EditorView} from "@codemirror/next/view"
import {treeHighlighter} from "@codemirror/next/highlight"
import {syntaxIndentation} from "./indent"
import {syntaxFolding} from "./fold"

type ConfigurableParser = IncrementalParser<{props: readonly NodePropSource[]}>

function addLanguageData<P extends ConfigurableParser>(parser: P, data: Facet<{[name: string]: any}>): P {
  return parser.configure({props: [languageDataProp.add(type => type.isTop ? data : undefined)]}) as P
}

/// A [syntax provider](#state.Syntax) based on a
/// [Lezer](https://lezer.codemirror.net) parser.
// FIXME rename/check docs
export class LezerSyntax<P extends IncrementalParser> implements Syntax {
  /// @internal
  readonly field: StateField<SyntaxState>

  /// The extension value to install this provider.
  readonly extension: Extension

  private constructor(
    /// The [language data](#state.EditorState.languageDataAt) data
    /// facet used for this language.
    readonly languageData: Facet<{[name: string]: any}>,
    /// The parser (with language data prop attached). Can be useful
    /// when using this as a [nested parser](#lezer.NestedParserSpec).
    readonly parser: P,
    private nested: boolean
  ) {
    let setSyntax = StateEffect.define<SyntaxState>()
    this.field = StateField.define<SyntaxState>({
      create(state) {
        let parseState = new ParseState(parser, state.doc, [], Tree.empty)
        if (!parseState.work(Work.Apply)) parseState.takeTree()
        return new SyntaxState(parseState)
      },
      update(value, tr) {
        for (let e of tr.effects) if (e.is(setSyntax)) return e.value
        return value.apply(tr)
      }
    })
    this.extension = [
      EditorState.syntax.of(this),
      this.field,
      ViewPlugin.define(view => new ParseWorker(view, this, setSyntax)),
      syntaxIndentation(this),
      syntaxFolding(this),
      treeHighlighter(this)
    ]
  }

  /// Define a syntax object. When basing it on a Lezer syntax, you'll
  /// want to use [`fromLezer`](#syntax.LezerSyntax^fromLezer) instead.
  static define<P extends ConfigurableParser>(spec: {
    /// The parser to use.
    parser: P,
    /// Whether this parser can nest other languages. Used to optimize
    /// [`languageData`](#state.EditorState.languageDataAt) in cases
    /// where there is only one language in the document. Defaults to
    /// false. When `parser` is a Lezer parser, this option is
    /// automatically taken from its `hasNested` property.
    nested?: boolean,
    /// [Language data](#state.EditorState.languageDataAt)
    /// to register for this language.
    languageData?: {[name: string]: any}
  }): LezerSyntax<P> {
    let {languageData, parser} = spec
    let data = Facet.define<{[name: string]: any}>({
      combine: languageData ? values => values.concat(languageData!) : undefined
    })
    let nested = spec.nested ?? !!(parser as any).hasNested
    return new LezerSyntax(data, addLanguageData(parser, data), nested)
  }

  /// Reconfigure the syntax by providing a new parser, but keeping
  /// the language data the same. This is useful when
  /// defining dialects for a custom parser.
  reconfigure(parser: P): LezerSyntax<P> {
    return new LezerSyntax(this.languageData, addLanguageData(parser, this.languageData), this.nested)
  }

  getTree(state: EditorState) {
    return state.field(this.field).tree
  }

  parsePos(state: EditorState) {
    return state.field(this.field).tree.length
  }

  ensureTree(state: EditorState, upto: number, timeout = 100): Tree | null {
    let parse = state.field(this.field).parse
    return parse.tree.length >= upto || parse.work(timeout, upto) ? parse.tree : null
  }

  languageDataFacetAt(state: EditorState, pos: number) {
    if (this.nested) {
      let tree = this.getTree(state)
      let target: SyntaxNode | null = tree.resolve(pos, -1)
      while (target) {
        let facet = target.type.prop(languageDataProp)
        if (facet) return facet
        target = target.parent
      }
    }
    return this.languageData
  }
}

export class DocInput implements Input {
  cursor: TextIterator
  cursorPos = 0
  string = ""
  prevString = ""

  constructor(readonly doc: Text, readonly length: number = doc.length) {
    this.cursor = doc.iter()
  }

  private syncTo(pos: number) {
    if (pos < this.cursorPos) { // Reset the cursor if we have to go back
      this.cursor = this.doc.iter()
      this.cursorPos = 0
    }
    this.prevString = pos == this.cursorPos ? this.string : ""
    this.string = this.cursor.next(pos - this.cursorPos).value
    this.cursorPos = pos + this.string.length
    return this.cursorPos - this.string.length
  }

  get(pos: number) {
    if (pos >= this.length) return -1
    let stringStart = this.cursorPos - this.string.length
    if (pos < stringStart || pos >= this.cursorPos) {
      if (pos < stringStart && pos >= stringStart - this.prevString.length)
        return this.prevString.charCodeAt(pos - (stringStart - this.prevString.length))
      stringStart = this.syncTo(pos)
    }
    return this.string.charCodeAt(pos - stringStart)
  }

  lineAfter(pos: number) {
    if (pos >= this.length || pos < 0) return ""
    let stringStart = this.cursorPos - this.string.length
    if (pos < stringStart || pos >= this.cursorPos) stringStart = this.syncTo(pos)
    let off = pos - stringStart, result = ""
    while (!this.cursor.lineBreak) {
      result += off ? this.string.slice(off) : this.string
      if (this.cursorPos >= this.length) {
        if (this.cursorPos > this.length) result = result.slice(0, result.length - (this.cursorPos - this.length))
        break
      }
      this.syncTo(this.cursorPos)
      off = 0
    }
    return result
  }

  read(from: number, to: number) {
    let stringStart = this.cursorPos - this.string.length
    if (from < stringStart || to >= this.cursorPos)
      return this.doc.sliceString(from, to)
    else
      return this.string.slice(from - stringStart, to - stringStart)
  }

  clip(at: number) {
    return new DocInput(this.doc, at)
  }
}

const enum Work {
  // Milliseconds of work time to perform immediately for a state doc change
  Apply = 25,
  // Minimum amount of work time to perform in an idle callback
  MinSlice = 25,
  // Amount of work time to perform in pseudo-thread when idle callbacks aren't supported
  Slice = 100,
  // Maximum pause (timeout) for the pseudo-thread
  Pause = 200,
  // Don't parse beyond this point unless explicitly requested to with `ensureTree`.
  MaxPos = 5e6
}

export class ParseState {
  private parse: IncrementalParse | null = null

  /// @internal
  constructor(
    private parser: IncrementalParser,
    private doc: Text,
    private fragments: readonly TreeFragment[] = [],
    public tree: Tree
  ) {}

  // FIXME do something with badness again
  work(time: number, upto?: number) {
    if (this.tree != Tree.empty && (upto == null ? this.tree.length == this.doc.length : this.tree.length >= upto))
      return true
    if (!this.parse)
      this.parse = this.parser.startParse(new DocInput(this.doc), {fragments: this.fragments})
    let endTime = Date.now() + time
    for (;;) {
      let done = this.parse.advance()
      if (done) {
        this.fragments = TreeFragment.addTree(done)
        this.parse = null
        this.tree = done
        return true
      } else if (upto != null && this.parse.pos >= upto) {
        this.takeTree()
        return true
      }
      if (Date.now() > endTime) return false
    }
  }
  
  takeTree() {
    if (this.parse && this.parse.pos > this.tree.length) {
      this.tree = this.parse.forceFinish()
      this.fragments = TreeFragment.addTree(this.tree, this.fragments, true)
    }
  }

  changes(changes: ChangeDesc, newDoc: Text) {
    let {fragments, tree} = this
    this.takeTree()
    if (!changes.empty) {
      let ranges: ChangedRange[] = []
      changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({fromA, toA, fromB, toB}))
      fragments = TreeFragment.applyChanges(fragments, ranges)
      tree = Tree.empty
    }
    return new ParseState(this.parser, newDoc, fragments, tree)
  }
}

class SyntaxState {
  // The current tree. Immutable, because directly accessible from
  // the editor state.
  readonly tree: Tree

  constructor(
    // A mutable parse state that is used to preserve work done during
    // the lifetime of a state when moving to the next state.
    readonly parse: ParseState
  ) {
    this.tree = parse.tree
  }

  apply(tr: Transaction) {
    if (!tr.docChanged) return this
    let newState = this.parse.changes(tr.changes, tr.newDoc)
    newState.work(Work.Apply)
    return new SyntaxState(newState)
  }
}

type Deadline = {timeRemaining(): number, didTimeout: boolean}
type IdleCallback = (deadline?: Deadline) => void

let requestIdle: (callback: IdleCallback, options: {timeout: number}) => number =
  typeof window != "undefined" && (window as any).requestIdleCallback ||
  ((callback: IdleCallback, {timeout}: {timeout: number}) => setTimeout(callback, timeout))
let cancelIdle: (id: number) => void = typeof window != "undefined" && (window as any).cancelIdleCallback || clearTimeout

class ParseWorker {
  working: number = -1

  constructor(readonly view: EditorView, 
              readonly syntax: LezerSyntax<ConfigurableParser>,
              readonly setSyntax: StateEffectType<SyntaxState>) {
    this.work = this.work.bind(this)
    this.scheduleWork()
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.scheduleWork()
  }

  scheduleWork() {
    if (this.working > -1) return
    let {state} = this.view, field = state.field(this.syntax.field)
    if (field.tree.length >= state.doc.length) return
    this.working = requestIdle(this.work, {timeout: Work.Pause})
  }

  work(deadline?: Deadline) {
    this.working = -1
    let {state} = this.view, field = state.field(this.syntax.field)
    if (field.tree.length >= state.doc.length) return
    field.parse.work(deadline ? Math.max(Work.MinSlice, deadline.timeRemaining()) : Work.Slice)
    if (field.parse.tree.length >= state.doc.length)
      this.view.dispatch({effects: this.setSyntax.of(new SyntaxState(field.parse))})
    else
      this.scheduleWork()
  }

  destroy() {
    if (this.working >= 0) cancelIdle(this.working)
  }
}
