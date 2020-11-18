import {Parser, ParseOptions, Input, ParseContext} from "lezer"
import {Tree, SyntaxNode, ChangedRange, TreeFragment} from "lezer-tree"
import {Text, TextIterator} from "@codemirror/next/text"
import {EditorState, StateField, Transaction, Syntax, Extension, StateEffect, StateEffectType,
        Facet, languageDataProp, ChangeDesc} from "@codemirror/next/state"
import {ViewPlugin, ViewUpdate, EditorView} from "@codemirror/next/view"
import {syntaxIndentation} from "./indent"
import {syntaxFolding} from "./fold"
import {treeHighlighter} from "@codemirror/next/highlight"

/// A [syntax provider](#state.Syntax) based on a
/// [Lezer](https://lezer.codemirror.net) parser.
export class LezerSyntax implements Syntax {
  /// @internal
  readonly field: StateField<SyntaxState>

  /// The extension value to install this provider.
  readonly extension: Extension

  /// @internal
  constructor(
    /// The Lezer parser used by this syntax.
    readonly parser: Parser,
    /// The dialect enabled for the parser.
    readonly dialect: string,
    /// The [language data](#state.EditorState.languageDataAt) data
    /// facet used for this language.
    readonly languageData: Facet<{[name: string]: any}>
  ) {
    let setSyntax = StateEffect.define<SyntaxState>()
    this.field = StateField.define<SyntaxState>({
      create(state) {
        let parseState = ParseState.create(parser, state.doc, dialect.length ? {dialect} : undefined)
        parseState.work(Work.Apply)
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

  /// Create a syntax instance for the given parser. You'll usually
  /// want to use the
  /// [`withProps`](https://lezer.codemirror.net/docs/ref/#lezer.Parser.withProps)
  /// method to register CodeMirror-specific syntax node props in the
  /// parser, before passing it to this constructor.
  static define(parser: Parser, config: {
    /// When [language data](#state.EditorState.languageDataAt) is
    /// given, it will be included in the syntax object's extension.
    languageData?: {[name: string]: any},
    /// The dialect of the grammar to use, if any.
    dialect?: string
  } = {}) {
    let languageData = Facet.define<{[name: string]: any}>({
      combine: config.languageData ? values => values.concat(config.languageData!) : undefined
    })
    return new LezerSyntax(parser.withProps(languageDataProp.add({[parser.topType.name]: languageData})),
                           config.dialect || "", languageData)
  }

  withDialect(dialect: string) {
    return new LezerSyntax(this.parser, dialect, this.languageData)
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
    if (this.parser.hasNested) {
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

class DocInput implements Input {
  cursor: TextIterator
  cursorPos = 0
  string = ""

  constructor(readonly doc: Text, readonly length: number = doc.length) {
    this.cursor = doc.iter()
  }

  get(pos: number) {
    if (pos >= this.length) return -1
    let stringStart = this.cursorPos - this.string.length
    if (pos < stringStart || pos >= this.cursorPos) {
      if (pos < this.cursorPos) { // Reset the cursor if we have to go back
        this.cursor = this.doc.iter()
        this.cursorPos = 0
      }
      this.string = this.cursor.next(pos - this.cursorPos).value
      this.cursorPos = pos + this.string.length
      stringStart = this.cursorPos - this.string.length
    }
    return this.string.charCodeAt(pos - stringStart)
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

class ParseState {
  private parse: ParseContext | null = null

  /// @internal
  constructor(
    private parser: Parser,
    private doc: Text,
    private fragments: readonly TreeFragment[] = [],
    public tree: Tree,
    private options?: ParseOptions
  ) {}

  work(time: number, upto?: number) {
    if (upto == null ? this.tree.length == this.doc.length : this.tree.length >= upto)
      return true
    if (!this.parse)
      this.parse = this.parser.startParse(new DocInput(this.doc), Object.assign({fragments: this.fragments}, this.options))
    let endTime = Date.now() + time
    for (;;) {
      let done = this.parse.advance()
      if (done) {
        this.fragments = TreeFragment.addTree(done)
        this.parse = null
        this.tree = done
        return true
      } else if (upto != null && this.parse.pos >= upto) {
        this.stop()
        return true
      }
      if (Date.now() > endTime) return false
    }
  }
  
  stop() {
    if (this.parse) {
      this.tree = this.parse.forceFinish()
      this.fragments = TreeFragment.addTree(this.tree, this.fragments, true)
    }
  }

  changes(changes: ChangeDesc, newDoc: Text) {
    let {fragments, tree} = this
    this.stop()
    if (!changes.empty) {
      let ranges: ChangedRange[] = []
      changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({fromA, toA, fromB, toB}))
      fragments = TreeFragment.applyChanges(fragments, ranges)
      tree = Tree.empty
    }
    return new ParseState(this.parser, newDoc, fragments, tree, this.options)
  }

  static create(parser: Parser, doc: Text, options?: ParseOptions) {
    return new ParseState(parser, doc, [], Tree.empty, options)
  }
}

class SyntaxState {
  // The current tree. Immutable, because directly accessible from
  // the editor state.
  readonly tree: Tree

  constructor(
    // A mutable parse state that is used to not throw away work done
    // during the lifetime of a state when moving to the next state.
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
              readonly syntax: LezerSyntax,
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
