import {Parser, InputStream, ParseContext} from "lezer"
import {Tree, Subtree, NodeProp} from "lezer-tree"
import {Text, TextIterator} from "../../text"
import {EditorState, StateField, Transaction, Syntax, languageData, Extension, Annotation} from "../../state"
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
    let setSyntax = Annotation.define<SyntaxState>()
    this.field = StateField.define<SyntaxState>({
      create(state) { return SyntaxState.advance(Tree.empty, parser, state.doc) },
      update(value, tr) { return value.apply(tr, parser, setSyntax) }
    })
    this.extension = [
      EditorState.syntax.of(this),
      this.field,
      EditorView.viewPlugin.of(view => new HighlightWorker(view, this, setSyntax)),
      syntaxIndentation(this),
      syntaxFolding(this)
    ]
  }

  getTree(state: EditorState) {
    return state.field(this.field).tree
  }

  parsePos(state: EditorState) {
    return state.field(this.field).upto
  }

  ensureTree(state: EditorState, upto: number, timeout = 100): Tree | null {
    let field = state.field(this.field)
    if (field.upto >= upto) return field.updatedTree
    if (!field.parse) field.startParse(this.parser, state.doc)

    if (field.parse!.pos < upto) {
      let done = work(field.parse!, timeout, upto)
      if (done) return field.stopParse(done, state.doc.length)
    }

    return field.parse!.pos < upto ? null : field.stopParse()
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

function work(parse: ParseContext, time: number, upto: number = -1) {
  let endTime = Date.now() + time
  for (;;) {
    let done = parse.advance()
    // FIXME stop parsing when parse.badness is too high
    if (done) return done
    if ((upto >= 0 && parse.pos > upto) || Date.now() > endTime) return null
  }
}

function takeTree(parse: ParseContext, base: Tree) {
  let parsed = parse.forceFinish()
  let after = base.applyChanges([{fromA: 0, toA: parse.pos, fromB: 0, toB: parse.pos}])
  return parsed.append(after)
}

class SyntaxState {
  public updatedTree: Tree // FIXME is it a good idea to separate this from .tree?
  public parse: ParseContext | null = null

  constructor(public tree: Tree, public upto: number) {
    this.updatedTree = tree
  }

  static advance(tree: Tree, parser: Parser, doc: Text) {
    let parse = parser.startParse(new DocStream(doc), {cache: tree})
    let done = work(parse, Work.Apply)
    return done ? new SyntaxState(done, doc.length) : new SyntaxState(takeTree(parse, tree), parse.pos)
  }

  apply(tr: Transaction, parser: Parser, annotation: (s: SyntaxState) => Annotation<SyntaxState>) {
    let given = tr.annotation(annotation)
    return given || (!tr.docChanged && this) || SyntaxState.advance(
      (this.parse ? takeTree(this.parse, this.updatedTree) : this.updatedTree).applyChanges(tr.changes.changedRanges()),
      parser, tr.doc)
  }

  startParse(parser: Parser, doc: Text) {
    this.parse = parser.startParse(new DocStream(doc), {cache: this.updatedTree})
  }

  stopParse(tree?: Tree, upto?: number) {
    if (!tree) tree = takeTree(this.parse!, this.updatedTree)
    this.updatedTree = tree
    this.upto = upto ?? this.parse!.pos
    this.parse = null
    return tree
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

  constructor(readonly view: EditorView,
              readonly syntax: LezerSyntax,
              readonly setSyntax: (s: SyntaxState) => Annotation<SyntaxState>) {
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
    if (!field.parse) field.startParse(this.syntax.parser, state.doc)
    let done = work(field.parse!, deadline ? Math.max(Work.MinSlice, deadline.timeRemaining()) : Work.Slice)
    // FIXME this needs more thought. When do we stop parsing? When do
    // we notify the state with the updated tree?
    if (done)
      this.view.dispatch(state.t().annotate(this.setSyntax(new SyntaxState(
        field.stopParse(done, state.doc.length), state.doc.length))))
    else
      this.scheduleWork()
  }

  destroy() {
    if (this.working >= 0) cancelIdle(this.working)
  }
}
