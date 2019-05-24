import {Parser, TagMap, SyntaxTree, Tree, InputStream} from "lezer"
import {Slot, SlotType} from "../../extension/src/extension"
import {Text} from "../../doc/src/"
import {EditorState, StateExtension, StateField, Transaction} from "../../state/src/"

// FIXME put lezer-specific definitions in different file from generic definitions. maybe even different package

export type ScopeMap = TagMap<string> // FIXME make compulsory field?

export abstract class Syntax {
  abstract extension: StateExtension

  constructor(readonly scopes: ScopeMap, private slots: ReadonlyArray<Slot> = []) {}

  getSlot<T>(type: SlotType<T>): T | undefined {
    return Slot.get(type, this.slots)
  }

  abstract getTree(state: EditorState, from: number, to: number): SyntaxTree
}

export class LezerSyntax extends Syntax {
  private field: StateField<SyntaxState>
  extension: StateExtension

  constructor(readonly parser: Parser, scopes: ScopeMap, slots: ReadonlyArray<Slot>) {
    super(scopes, slots)
    this.field = new StateField<SyntaxState>({
      init() { return new SyntaxState(Tree.empty) },
      apply(tr, value) { return value.apply(tr) }
    })
    this.extension = StateExtension.all(syntax(this), this.field.extension)
  }

  getTree(state: EditorState, from: number, to: number): SyntaxTree {
    return state.getField(this.field).getTree(this.parser, state.doc, from, to)
  }
}

export const syntax = StateExtension.defineBehavior<Syntax>()

export function syntaxTree(state: EditorState, from: number, to: number): {syntax: Syntax, tree: SyntaxTree} | null {
  let found = state.behavior.get(syntax)[0]
  return found ? {syntax: found, tree: found.getTree(state, from, to)} : null
}

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

  peek(pos = this.pos) {
    return pos < 0 || pos >= this.doc.length ? -1 : this.doc.slice(this.pos, this.pos + 1).charCodeAt(0)
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

  constructor(private tree: SyntaxTree) {}

  apply(tr: Transaction) {
    return new SyntaxState(this.tree.unchanged(tr.changes.changedRanges()))
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
