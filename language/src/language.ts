import {Tree, SyntaxNode, ChangedRange, TreeFragment, NodeProp, Input, IncrementalParse, StartParse} from "lezer-tree"
// NOTE: This package should only use _types_ from "lezer", to avoid
// pulling in that dependency when no actual Lezer-based parser is used.
import {Parser, ParserConfig} from "lezer"
import {Text, TextIterator} from "@codemirror/next/text"
import {EditorState, StateField, Transaction, Extension, StateEffect, StateEffectType,
        Facet, ChangeDesc} from "@codemirror/next/state"
import {ViewPlugin, ViewUpdate, EditorView} from "@codemirror/next/view"
import {treeHighlighter} from "@codemirror/next/highlight"

/// Node prop stored on a grammar's top node to indicate the facet used
/// to store language data related to that language.
export const languageDataProp = new NodeProp<Facet<{[name: string]: any}>>()

/// Helper function to define a facet (to be added to the top syntax
/// node(s) for a language via
/// [`languageDataProp`](#language.languageDataProp)), that will be
/// used to associate language data with the language. You
/// probably only need this when subclassing
/// [`Language`](#language.Language).
export function defineLanguageFacet(baseData?: {[name: string]: any}) {
  return Facet.define<{[name: string]: any}>({
    combine: baseData ? values => values.concat(baseData!) : undefined
  })
}

/// A language object manages parsing and per-language
/// [metadata](#state.EditorState.languageDataAt). Parse data is
/// managed as a [Lezer](https://lezer.codemirror.net) tree. You'll
/// want to subclass this class for custom parsers, or use the
/// [`LezerLanguage`](#language.LezerLanguage) or
/// [`StreamLanguage`](#stream-parser.StreamLanguage) abstractions for
/// [Lezer](https://lezer.codemirror.net/) or stream parsers.
export class Language {
  private field: StateField<LanguageState>

  /// The extension value to install this provider.
  readonly extension: Extension

  /// The parser (with [language data
  /// prop](#language.defineLanguageProp) attached). Can be useful
  /// when using this as a [nested parser](#lezer.NestedParserSpec).
  parser: {startParse: StartParse}

  protected constructor(
    /// The [language data](#state.EditorState.languageDataAt) data
    /// facet used for this language.
    readonly data: Facet<{[name: string]: any}>,
    parser: {startParse(input: Input, pos?: number, context?: ParseContext): IncrementalParse},
    extraExtensions: Extension[] = []
  ) {
    let setState = StateEffect.define<LanguageState>()
    this.parser = parser as {startParse: StartParse}
    this.field = StateField.define<LanguageState>({
      create(state) {
        let parseState = new ParseState(parser, state, [], Tree.empty)
        if (!parseState.work(Work.Apply)) parseState.takeTree()
        return new LanguageState(parseState)
      },
      update(value, tr) {
        for (let e of tr.effects) if (e.is(setState)) return e.value
        return value.apply(tr)
      }
    })
    this.extension = [
      EditorState.language.of(this),
      this.field,
      ViewPlugin.define(view => new ParseWorker(view, this.field, setState)),
      treeHighlighter(this)
    ].concat(extraExtensions)
  }

  /// Retrieve the parser tree for a given state.
  getTree(state: EditorState) {
    return state.field(this.field).tree
  }

  /// Try to get a parse tree that spans at least up to `upto`. The
  /// method will do at most `timeout` milliseconds of work to parse
  /// up to that point if the tree isn't already available.
  ensureTree(state: EditorState, upto: number, timeout = 100): Tree | null {
    let parse = state.field(this.field).parse
    return parse.tree.length >= upto || parse.work(timeout, upto) ? parse.tree : null
  }

  /// Find the facet associated with the language at the given position.
  // FIXME simplify by always getting language data from a facet?
  languageDataFacetAt(state: EditorState, pos: number) {
    let tree = this.getTree(state)
    let target: SyntaxNode | null = tree.resolve(pos, -1)
    while (target) {
      let facet = target.type.prop(languageDataProp)
      if (facet) return facet
      target = target.parent
    }
    return this.data
  }
}


export class ParseContext {
  constructor(readonly state: EditorState,
              readonly fragments: readonly TreeFragment[],
              readonly viewport: {from: number, to: number} | null) {}
}

/// A subclass of `Language` for use with [Lezer](#lezer.Parser)
/// parsers.
export class LezerLanguage extends Language {
  private constructor(data: Facet<{[name: string]: any}>,
                      readonly parser: Parser) {
    super(data, parser)
  }

  /// Define a language from a parser.
  static define(spec: {
    /// The parser to use. Should already have added editor-relevant
    /// node props (and optionally things like dialect and top rule)
    /// configured.
    parser: Parser,
    /// [Language data](#state.EditorState.languageDataAt)
    /// to register for this language.
    languageData?: {[name: string]: any}
  }) {
    let data = defineLanguageFacet(spec.languageData)
    return new LezerLanguage(data, spec.parser.configure({
      props: [languageDataProp.add(type => type.isTop ? data : undefined)]
    }))
  }

  /// Create a new instance of this language with a reconfigured
  /// version of its parser.
  configure(options: ParserConfig): LezerLanguage {
    return new LezerLanguage(this.data, this.parser.configure(options))
  }

  languageDataFacetAt(state: EditorState, pos: number) {
    return this.parser.hasNested ? super.languageDataFacetAt(state, pos) : this.data
  }
}

/// Get the syntax tree for a state, which is the current (possibly
/// incomplete) parse tree of the [language](#language.Language) with
/// the highest precedence, or the empty tree if there is no language
/// available.
export function syntaxTree(state: EditorState) {
  let lang = state.facet(EditorState.language)
  return lang.length ? lang[0].getTree(state) : Tree.empty
}

// Lezer-style Input object for a Text document.
class DocInput implements Input {
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
    private parser: {startParse(input: Input, pos?: number, context?: ParseContext): IncrementalParse},
    private state: EditorState,
    private fragments: readonly TreeFragment[] = [],
    public tree: Tree
  ) {}

  // FIXME do something with badness again
  work(time: number, upto?: number) {
    if (this.tree != Tree.empty && (upto == null ? this.tree.length == this.state.doc.length : this.tree.length >= upto))
      return true
    if (!this.parse)
      this.parse = this.parser.startParse(new DocInput(this.state.doc), 0, new ParseContext(this.state, this.fragments, null))
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

  changes(changes: ChangeDesc, newState: EditorState) {
    let {fragments, tree} = this
    this.takeTree()
    if (!changes.empty) {
      let ranges: ChangedRange[] = []
      changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({fromA, toA, fromB, toB}))
      fragments = TreeFragment.applyChanges(fragments, ranges)
      tree = Tree.empty
    }
    return new ParseState(this.parser, newState, fragments, tree)
  }
}

class LanguageState {
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
    let newState = this.parse.changes(tr.changes, tr.state)
    newState.work(Work.Apply)
    return new LanguageState(newState)
  }
}

type Deadline = {timeRemaining(): number, didTimeout: boolean}
type IdleCallback = (deadline?: Deadline) => void

let requestIdle: (callback: IdleCallback, options: {timeout: number}) => number =
  typeof window != "undefined" && (window as any).requestIdleCallback ||
  ((callback: IdleCallback, {timeout}: {timeout: number}) => setTimeout(callback, timeout))
let cancelIdle: (id: number) => void = typeof window != "undefined" && (window as any).cancelIdleCallback || clearTimeout

// FIXME figure out some way to back off from full re-parses when the
// document is large—you could waste a lot of battery re-parsing a
// multi-megabyte document every time you insert a backtick, even if
// it happens in the background.
class ParseWorker {
  working: number = -1

  constructor(readonly view: EditorView, 
              readonly field: StateField<LanguageState>,
              readonly setState: StateEffectType<LanguageState>) {
    this.work = this.work.bind(this)
    this.scheduleWork()
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.scheduleWork()
  }

  scheduleWork() {
    if (this.working > -1) return
    let {state} = this.view, field = state.field(this.field)
    if (field.tree.length >= state.doc.length) return
    this.working = requestIdle(this.work, {timeout: Work.Pause})
  }

  work(deadline?: Deadline) {
    this.working = -1
    let {state} = this.view, field = state.field(this.field)
    if (field.tree.length >= state.doc.length) return
    field.parse.work(deadline ? Math.max(Work.MinSlice, deadline.timeRemaining()) : Work.Slice)
    if (field.parse.tree.length >= state.doc.length)
      this.view.dispatch({effects: this.setState.of(new LanguageState(field.parse))})
    else
      this.scheduleWork()
  }

  destroy() {
    if (this.working >= 0) cancelIdle(this.working)
  }
}
