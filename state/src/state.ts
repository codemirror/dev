import {Text} from "../../doc/src/text"

export class EditorState {
  constructor(public readonly doc: Text, public readonly selection: Selection = Selection.default) {}

  get transaction(): Transaction {
    return Transaction.start(this)
  }
}

export class Range {
  constructor(public readonly anchor: number, public readonly head: number = anchor) {}

  get from(): number { return Math.min(this.anchor, this.head) }
  get to(): number { return Math.max(this.anchor, this.head) }
  get empty(): boolean { return this.anchor == this.head }

  map(change: Change): Range {
    let anchor = change.mapPos(this.anchor), head = change.mapPos(this.head)
    if (anchor == this.anchor && head == this.head) return this
    else return new Range(anchor, head)
  }
}

// FIXME remove/join on overlap, maybe sort, store primary index
export class Selection {
  constructor(public readonly ranges: ReadonlyArray<Range>) {}

  map(change: Change): Selection {
    return new Selection(this.ranges.map(r => r.map(change)))
  }

  get primary(): Range { return this.ranges[0] }

  static default: Selection = new Selection([new Range(0)]);
}

const empty: any[] = []

class Meta {
  constructor(from: Meta | null = null) {
    if (from) for (let prop in from) this[prop] = from[prop]
  }
  [key: string]: any;
}
Meta.prototype["__proto__"] = null

export class Transaction {
  private constructor(public readonly startState: EditorState,
                      public readonly changes: ReadonlyArray<Change>,
                      public readonly docs: ReadonlyArray<Text>,
                      public readonly selection: Selection,
                      private readonly meta: Meta) {}

  static start(state: EditorState, time: number = Date.now()) {
    let meta = new Meta
    meta.time = time
    return new Transaction(state, empty, empty, state.selection, meta)
  }

  get doc(): Text {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  setMeta(name: string, value: any) {
    let meta = new Meta(this.meta)
    meta[name] = value
    return new Transaction(this.startState, this.changes, this.docs, this.selection, meta)
  }

  getMeta(name: string): any {
    return this.meta[name]
  }

  change(change: Change): Transaction {
    if (change.from == change.to && change.text == "") return this
    return new Transaction(this.startState,
                           this.changes.concat(change),
                           this.docs.concat(change.apply(this.doc)),
                           this.selection.map(change), this.meta)
  }

  replaceSelection(text: string): Transaction {
    return this.reduceRanges((state, r) => {
      return state.change(new Change(r.from, r.to, text))
    })
  }

  reduceRanges(f: (transaction: Transaction, range: Range) => Transaction): Transaction {
    let tr: Transaction = this
    let sel = tr.selection, start = tr.changes.length
    for (let i = 0; i < sel.ranges.length; i++) {
      let range = sel.ranges[i]
      for (let j = start; j < tr.changes.length; j++)
        range = range.map(tr.changes[j])
      tr = f(tr, range)
    }
    return tr
  }

  apply(): EditorState {
    return new EditorState(this.doc, this.selection)
  }
}

export class Change {
  constructor(public readonly from: number, public readonly to: number, public readonly text: string) {}

  invert(doc: Text) {
    return new Change(this.from, this.from + this.text.length, doc.slice(this.from, this.to))
  }

  mapPos(pos: number, bias: number = 1) {
    if (pos < this.from || bias < 0 && pos == this.from) return pos
    if (pos > this.to) return pos + this.text.length - (this.to - this.from)
    let side = this.from == this.to ? bias : pos == this.from ? -1 : pos == this.to ? 1 : bias
    return this.from + (side < 0 ? 0 : this.text.length)
  }

  apply(doc: Text): Text {
    return doc.replace(this.from, this.to, this.text)
  }
}
