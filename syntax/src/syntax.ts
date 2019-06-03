import {Parser, Tree, InputStream} from "lezer"
import {Slot, SlotType} from "../../extension/src/extension"
import {Text} from "../../doc/src/"
import {EditorState, StateExtension, StateField, Transaction} from "../../state/src/"

// FIXME put lezer-specific definitions in different file from generic definitions. maybe even different package

export abstract class Syntax {
  abstract extension: StateExtension

  constructor(readonly name: string, private slots: Slot[] = []) {}

  getSlot<T>(type: SlotType<T>): T | undefined {
    return Slot.get(type, this.slots)
  }

  addSlot<T>(slot: Slot<T>) {
    this.slots.push(slot)
  }

  abstract getTree(state: EditorState, from: number, to: number): Tree
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

  getTree(state: EditorState, from: number, to: number): Tree {
    return state.getField(this.field).getTree(this.parser, state.doc, from, to)
  }
}

export const syntax = StateExtension.defineBehavior<Syntax>()

class DocStream implements InputStream {
  pos = 0
  token = -1
  tokenEnd = -1

  constructor(readonly doc: Text) {}

  get length() { return this.doc.length }

  next() {
    if (this.pos >= this.doc.length) return -1
    // FIXME keep cursor
    let ch = this.doc.slice(this.pos, this.pos + 1).charCodeAt(0)
    this.pos++
    return ch
  }

  // FIXME optimize
  peek(pos = this.pos) {
    return pos < 0 || pos >= this.doc.length ? -1 : this.doc.slice(pos, pos + 1).charCodeAt(0)
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
    return this.doc.slice(from, to)
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
