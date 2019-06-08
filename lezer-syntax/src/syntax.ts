import {Parser, ParseContext, Tree, InputStream} from "lezer"
import {Slot} from "../../extension/src/extension"
import {Text, TextIterator} from "../../doc/src/"
import {EditorState, StateExtension, StateField, Transaction, Syntax, SyntaxRequest} from "../../state/src/"

// FIXME rename package to lezer-syntax

export class LezerSyntax extends Syntax {
  private field: StateField<SyntaxState>
  extension: StateExtension

  constructor(name: string, readonly parser: Parser, slots: Slot[] = []) {
    super(name, slots)
    this.field = new StateField<SyntaxState>({
      init() { return new SyntaxState(Tree.empty) },
      apply(tr, value) { return value.apply(tr) }
    })
    this.extension = StateExtension.all(StateExtension.syntax(this), this.field.extension)
  }

  tryGetTree(state: EditorState, from: number, to: number, unfinished?: (promise: SyntaxRequest) => void): Tree {
    return state.getField(this.field).getTree(this.parser, state.doc, from, to, unfinished)
  }
}

class DocStream implements InputStream {
  pos = 0
  token = -1
  tokenEnd = -1
  cursor: TextIterator
  cursorPos = 0
  string = ""

  constructor(readonly doc: Text) {
    this.cursor = doc.iter()
  }

  get length() { return this.doc.length }

  next() {
    if (this.pos >= this.doc.length) return -1
    let stringStart = this.cursorPos - this.string.length
    if (this.pos < stringStart || this.pos >= this.cursorPos) {
      if (this.pos < this.cursorPos) { // Reset the cursor if we have to go back
        this.cursor = this.doc.iter()
        this.cursorPos = 0
      }
      this.string = this.cursor.next(this.pos - this.cursorPos).value
      this.cursorPos = this.pos + this.string.length
      stringStart = this.cursorPos - this.string.length
    }
    let ch = this.string.charCodeAt(this.pos - stringStart)
    this.pos++
    return ch
  }

  peek(pos = this.pos) {
    if (pos < 0 || pos >= this.doc.length) return -1
    let stringStart = this.cursorPos - this.string.length
    if (pos < stringStart || pos >= this.cursorPos)
      return this.doc.slice(pos, pos + 1).charCodeAt(0)
    else
      return this.string.charCodeAt(pos - stringStart)
  }

  accept(term: number, pos = this.pos) {
    this.token = term
    this.tokenEnd = pos
  }

  goto(n: number) {
    this.token = this.tokenEnd = -1
    this.pos = n
    return this
  }

  read(from: number, to: number) {
    let stringStart = this.cursorPos - this.string.length
    if (from < stringStart || to >= this.cursorPos)
      return this.doc.slice(from, to)
    else
      return this.string.slice(from - stringStart, to - stringStart)
  }
}

const WORK_SLICE = 100, WORK_PAUSE = 200

class RequestInfo {
  promise: SyntaxRequest
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

  constructor(private tree: Tree) {}

  apply(tr: Transaction) {
    return tr.docChanged ? new SyntaxState(this.tree.unchanged(tr.changes.changedRanges())) : this
  }

  // FIXME implement clearing out parts of the tree when it is too big
  getTree(parser: Parser, doc: Text, from: number, to: number, unfinished?: (promise: SyntaxRequest) => void) {
    if (to <= this.parsedTo) return this.tree

    if (!this.parse) this.parse = parser.startParse(new DocStream(doc), {cache: this.tree})
    this.continueParse(to)
    if (this.parsedTo < to && unfinished) {
      this.scheduleWork()
      let req = this.requests.find(r => r.upto == to && !r.promise.canceled)
      if (!req) this.requests.push(req = new RequestInfo(to))
      unfinished(req.promise)
    }
    return this.tree
  }

  continueParse(to: number) {
    let endTime = Date.now() + WORK_SLICE
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
    this.tree = this.parse!.forceFinish()
    if (this.parsedTo >= to) this.parse = null
  }

  scheduleWork() {
    if (this.working != -1) return
    this.working = setTimeout(() => this.work(), WORK_PAUSE) as any
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
