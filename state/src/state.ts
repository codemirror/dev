import {Rope} from "../../doc/src/rope"

export class EditorState {
  constructor(public readonly doc: Rope, public readonly selection: Selection = Selection.default) {}

  get transaction(): Transaction {
    return new Transaction(this)
  }
}

export class Range {
  constructor(public readonly anchor: number, public readonly head: number = anchor) {}

  get from(): number { return Math.min(this.anchor, this.head) }
  get to(): number { return Math.max(this.anchor, this.head) }
  get empty(): boolean { return this.anchor == this.head }

  map(change: Change): Range {
    let anchor = change.map(this.anchor), head = change.map(this.head)
    if (anchor == this.anchor && head == this.head) return this
    else return new Range(anchor, head)
  }
}

// FIXME remove/join on overlap, maybe sort, store primary index
export class Selection {
  constructor(public readonly ranges: Range[]) {}

  map(change: Change): Selection {
    return new Selection(this.ranges.map(r => r.map(change)))
  }

  get primary(): Range { return this.ranges[0] }

  static default: Selection = new Selection([new Range(0)]);
}

export class Transaction {
  changes: Change[];
  docs: Rope[];
  private currentSelection: Selection;
  private currentSelectionAt: number;

  constructor(public startState: EditorState) {
    this.changes = []
    this.docs = []
    this.currentSelection = startState.selection
    this.currentSelectionAt = 0
  }

  get doc(): Rope {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  get selection(): Selection {
    while (this.currentSelectionAt < this.changes.length) {
      this.currentSelection = this.currentSelection.map(this.changes[this.currentSelectionAt])
      this.currentSelectionAt++
    }
    return this.currentSelection
  }

  change(change: Change): Transaction {
    this.changes.push(change)
    this.docs.push(change.apply(this.doc))
    return this
  }

  replaceSelection(text: string): Transaction {
    this.forEachRange(r => {
      this.change(new Change(r.from, r.to, text))
    })
    return this
  }

  forEachRange(f: (range: Range) => void) {
    let sel = this.selection, start = this.changes.length
    for (let i = 0; i < sel.ranges.length; i++) {
      let range = sel.ranges[i]
      for (let j = start; j < this.changes.length; j++)
        range = range.map(this.changes[j])
      f(range)
    }
  }

  apply(): EditorState {
    return new EditorState(this.doc, this.selection)
  }
}

export class Change {
  constructor(public readonly from: number, public readonly to: number, public readonly text: string) {}

  invert(doc: Rope) {
    return new Change(this.from, this.from + this.text.length, doc.slice(this.from, this.to))
  }

  map(pos: number, bias: number = 1) {
    if (pos < this.from || bias < 0 && pos == this.from) return pos
    if (pos > this.to) return pos + this.text.length - (this.to - this.from)
    let side = this.from == this.to ? bias : pos == this.from ? -1 : pos == this.to ? 1 : bias
    return this.from + (side < 0 ? 0 : this.text.length)
  }

  apply(doc: Rope): Rope {
    return doc.replace(this.from, this.to, this.text)
  }
}
