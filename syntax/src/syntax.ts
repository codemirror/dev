import {Parser, Tree, InputStream} from "lezer"
import {Slot, SlotType} from "../../extension/src/extension"
import {Text, TextIterator} from "../../doc/src/"
import {EditorState, StateExtension, StateField, Transaction} from "../../state/src/"

// FIXME put lezer-specific definitions in different file from generic definitions. maybe even different package

export type TreeRequest = Promise<Tree> & {canceled?: boolean}

export abstract class Syntax {
  abstract extension: StateExtension

  constructor(readonly name: string, private slots: Slot[] = []) {}

  getSlot<T>(type: SlotType<T>): T | undefined {
    return Slot.get(type, this.slots)
  }

  addSlot<T>(slot: Slot<T>) {
    this.slots.push(slot)
  }

  abstract getTree(state: EditorState, from: number, to: number): TreeRequest
  abstract tryGetTree(state: EditorState, from: number, to: number, unfinished?: (req: TreeRequest) => void): Tree
}

export class LezerSyntax extends Syntax {
  private field: StateField<SyntaxState>
  extension: StateExtension

  constructor(name: string, readonly parser: Parser, slots: Slot[] = []) {
    super(name, slots)
    this.field = new StateField<SyntaxState>({
      init() { return new SyntaxState(Tree.empty) },
      apply(tr, value) { return value.apply(tr) }
    })
    this.extension = StateExtension.all(syntax(this), this.field.extension)
  }

  getTree(state: EditorState, from: number, to: number): TreeRequest {
    return Promise.resolve(this.tryGetTree(state, from, to))
  }

  // FIXME add actual incrementality
  tryGetTree(state: EditorState, from: number, to: number): Tree {
    return state.getField(this.field).getTree(this.parser, state.doc, from, to)
  }
}

export const syntax = StateExtension.defineBehavior<Syntax>()

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

class SyntaxState {
  private parsed = false

  constructor(private tree: Tree) {}

  apply(tr: Transaction) {
    return tr.docChanged ? new SyntaxState(this.tree.unchanged(tr.changes.changedRanges())) : this
  }

  getTree(parser: Parser, doc: Text, from: number, to: number) {
    // FIXME support timing out
    // FIXME support partial parsing
    // FIXME return Syntax object along with tree
    if (!this.parsed) {
      this.tree = parser.parse(new DocStream(doc), {cache: this.tree})
      this.parsed = true
    }
    return this.tree
  }
}
