import {Parser, InputStream} from "lezer"
import {Tree, Subtree, NodeProp} from "lezer-tree"
import {Text, TextIterator} from "../../text"
import {EditorState, StateField, Transaction, Syntax, languageData, Extension} from "../../state"
import {ViewPlugin, EditorView} from "../../view"
import {syntaxIndentation} from "./indent"
import {syntaxFolding} from "./fold"

/// A [syntax provider](#state.Syntax) based on a
/// [Lezer](https://lezer.codemirror.net) parser.
export class LezerSyntax implements Syntax {
  readonly field: StateField<SyntaxState>
  /// The extension value to install this provider.
  readonly extension: Extension

  /// Create a syntax instance for the given parser. You'll usually
  /// want to use the
  /// [`withProps`](https://lezer.codemirror.net/docs/ref/#lezer.Parser.withProps)
  /// method to register CodeMirror-specific syntax node props in the
  /// parser, before passing it to this constructor.
  constructor(readonly parser: Parser) {
    this.field = StateField.define<SyntaxState>({
      create(state) { return SyntaxState.init(Tree.empty, parser, state.doc) },
      update(value, tr) { return value.apply(tr, parser) }
    })
    this.extension = [
      EditorState.syntax.of(this),
      this.field,
      EditorView.viewPlugin.of(view => new HighlightWorker(view, this)),
      syntaxIndentation(this),
      syntaxFolding(this)
    ]
  }

  getTree(state: EditorState) {
    return state.field(this.field).tree
  }

  ensureTree(state: EditorState, upto: number, timeout = 100): Tree | null {
    let field = state.field(this.field)
    if (field.upto >= upto) return field.updatedTree
    if (field.work(this.parser, state.doc, upto, timeout)) return field.updatedTree
    return null
  }

  get docNodeType() { return this.parser.group.types[1] }

  languageDataAt<Interface = any>(state: EditorState, pos: number) {
    let type = this.parser.group.types[1]
    if (this.parser.hasNested) {
      let tree = this.getTree(state)
      let target: Subtree | null = tree.resolve(pos)
      while (target) {
        if (target.type.prop(NodeProp.top)) {
          type = target.type
          break
        }
        target = target.parent
      }
    }
    return (type.prop(languageData) || nothing) as Interface
  }
}

const nothing = {}

// FIXME limit parsing to some maximum doc size, possibly by making the docstream end there

class DocStream implements InputStream {
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
      return this.doc.slice(from, to)
    else
      return this.string.slice(from - stringStart, to - stringStart)
  }

  clip(at: number) {
    return new DocStream(this.doc, at)
  }
}

const enum Work { Apply = 25, MinSlice = 75, Slice = 100, Pause = 200 }

class SyntaxState {
  public updatedTree: Tree // FIXME is it a good idea to separate this from .tree?

  constructor(public tree: Tree, public upto: number) {
    this.updatedTree = tree
  }

  static init(tree: Tree, parser: Parser, doc: Text) {
    let state = new SyntaxState(tree, 0)
    state.work(parser, doc, doc.length, Work.Apply)
    state.tree = state.updatedTree
    return state
  }

  apply(tr: Transaction, parser: Parser) {
    return !tr.docChanged && this.updatedTree == this.tree ? this
      : this.upto >= tr.doc.length && !tr.docChanged ? new SyntaxState(this.updatedTree, this.upto)
      : SyntaxState.init(this.updatedTree.applyChanges(tr.changes.changedRanges()), parser, tr.doc)
  }

  work(parser: Parser, doc: Text, upto: number, maxTime: number): boolean {
    if (upto <= this.upto) return true

    let parse = parser.startParse(new DocStream(doc), {cache: this.updatedTree})
    let endTime = Date.now() + maxTime
    for (;;) {
      let done = parse.advance()
      // FIXME stop parsing when parse.badness is too high
      if (done) {
        this.upto = doc.length
        this.updatedTree = done
        return true
      }
      if (parse.pos > upto || Date.now() > endTime) {
        this.upto = parse.pos
        let parsed = parse.forceFinish()
        let after = this.updatedTree.applyChanges([{fromA: 0, toA: parse.pos, fromB: 0, toB: parse.pos}])
        this.updatedTree = parsed.append(after)
        return this.upto >= upto
      }
    }
  }
}

type Deadline = {timeRemaining(): number, didTimeout: boolean}
type IdleCallback = (deadline?: Deadline) => void

let requestIdle: (callback: IdleCallback, options: {timeout: number}) => number =
  typeof window != "undefined" && (window as any).requestIdleCallback ||
  ((callback: IdleCallback, {timeout}: {timeout: number}) => setTimeout(callback, timeout))
let cancelIdle: (id: number) => void = typeof window != "undefined" && (window as any).cancelIdleCallback || clearTimeout

class HighlightWorker extends ViewPlugin {
  working: number = -1

  constructor(readonly view: EditorView, readonly syntax: LezerSyntax) {
    super()
    this.work = this.work.bind(this)
    this.scheduleWork()
  }

  update() {
    this.scheduleWork()
  }

  scheduleWork() {
    if (this.working > -1) return
    let {state} = this.view, field = state.field(this.syntax.field)
    if (field.upto >= state.doc.length) return
    this.working = requestIdle(this.work, {timeout: Work.Pause})
  }

  work(deadline?: Deadline) {
    this.working = -1
    let {state} = this.view, field = state.field(this.syntax.field)
    if (field.upto >= state.doc.length) return
    let prev = field.upto
    field.work(this.syntax.parser, state.doc, state.doc.length,
               deadline ? Math.max(Work.MinSlice, deadline.timeRemaining()) : Work.Slice)
    // FIXME this needs more thought. Right now, we fire a transaction
    // when the parsing crossed the end of the viewport, and when the
    // entire document is highlighted. Is that a good approach?
    if (field.upto == state.doc.length ||
        prev < this.view.viewport.to && field.upto >= this.view.viewport.to)
      this.view.dispatch(state.t())
    if (field.upto < state.doc.length) this.scheduleWork()
  }

  destroy() {
    if (this.working >= 0) cancelIdle(this.working)
  }
}
