import {Parser, ParseContext, InputStream} from "lezer"
import {Tree, Subtree, NodeProp} from "lezer-tree"
import {Text, TextIterator} from "../../text"
import {EditorState, StateField, Transaction, Syntax, languageData, CancellablePromise} from "../../state"
import {Extension} from "../../extension"
import {syntaxIndentation} from "./indent"
import {syntaxFolding} from "./fold"

/// A [syntax provider](#state.Syntax) based on a
/// [Lezer](https://lezer.codemirror.net) parser.
export class LezerSyntax implements Syntax {
  private field: StateField<SyntaxState>
  /// The extension value to install this provider.
  readonly extension: Extension

  /// Create a syntax instance for the given parser. You'll usually
  /// want to use the
  /// [`withProps`](https://lezer.codemirror.net/docs/ref/#lezer.Parser.withProps)
  /// method to register CodeMirror-specific syntax node props in the
  /// parser, before passing it to this constructor.
  constructor(readonly parser: Parser) {
    this.field = new StateField<SyntaxState>({
      init() { return new SyntaxState(Tree.empty) },
      apply(tr, value) { return value.apply(tr) }
    })
    this.extension = [EditorState.syntax(this), this.field.extension, syntaxIndentation(this), syntaxFolding(this)]
  }

  tryGetTree(state: EditorState, from: number, to: number) {
    let field = state.field(this.field)
    return field.updateTree(this.parser, state.doc, from, to, false) ? field.tree : null
  }

  getTree(state: EditorState, from: number, to: number) {
    let field = state.field(this.field)
    let rest = field.updateTree(this.parser, state.doc, from, to, true) as CancellablePromise<Tree> | true
    return {tree: field.tree, rest: rest === true ? null : rest}
  }

  getPartialTree(state: EditorState, from: number, to: number) {
    let field = state.field(this.field)
    field.updateTree(this.parser, state.doc, from, to, false)
    return field.tree
  }

  languageDataAt<Interface = any>(state: EditorState, pos: number) {
    let type = this.parser.group.types[1]
    if (this.parser.hasNested) {
      let tree = this.getPartialTree(state, pos, pos)
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

const enum Work { Slice = 100, Pause = 200 }

class RequestInfo {
  promise: CancellablePromise<Tree>
  resolve!: (tree: Tree) => void

  constructor(readonly upto: number) {
    this.promise = new Promise<Tree>(r => this.resolve = r)
    this.promise.canceled = false
  }
}

class SyntaxState {
  private parsedTo = 0
  private parse: ParseContext | null = null
  private working = -1
  private requests: RequestInfo[] = []

  constructor(public tree: Tree) {}

  apply(tr: Transaction) {
    return tr.docChanged ? new SyntaxState(this.tree.applyChanges(tr.changes.changedRanges())) : this
  }


  // FIXME implement clearing out parts of the tree when it is too big
  updateTree(parser: Parser, doc: Text, from: number, to: number, rest: boolean): boolean | CancellablePromise<Tree> {
    if (to <= this.parsedTo) return true

    if (!this.parse) {
      this.parse = parser.startParse(new DocStream(doc), {cache: this.tree})
      this.continueParse(to)
    }
    if (this.parsedTo >= to) return true
    if (!rest) return false
    this.scheduleWork()
    let req = this.requests.find(r => r.upto == to && !r.promise.canceled)
    if (!req) this.requests.push(req = new RequestInfo(to))
    return req.promise
  }

  continueParse(to: number) {
    let endTime = Date.now() + Work.Slice
    for (let i = 0;; i++) {
      let done = this.parse!.advance()
      if (done) {
        this.parsedTo = 1e9
        this.parse = null
        this.tree = done
        return
      }
      if (i == 1000) {
        i = 0
        if (Date.now() > endTime) break
      }
    }
    this.parsedTo = this.parse!.pos
    // FIXME somehow avoid rebuilding all the nodes that are already
    // in this.tree when this happens repeatedly
    this.tree = this.parse!.forceFinish()
    if (this.parsedTo >= to) this.parse = null
  }

  scheduleWork() {
    if (this.working != -1) return
    this.working = setTimeout(() => this.work(), Work.Pause) as any
  }

  work() {
    this.working = -1
    let to = this.requests.reduce((max, req) => req.promise.canceled ? max : Math.max(max, req.upto), 0)
    if (to > this.parsedTo) this.continueParse(to)

    this.requests = this.requests.filter(req => {
      if (!req.promise.canceled && req.upto > this.parsedTo) return true
      if (!req.promise.canceled) req.resolve(this.tree)
      return false
    })
    if (this.requests.length) this.scheduleWork()
  }
}
