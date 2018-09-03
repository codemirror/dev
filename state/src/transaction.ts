import {Text} from "../../doc/src/text"
import {EditorState} from "./state"
import {EditorSelection, SelectionRange} from "./selection"
import {unique} from "./plugin"
import {Change, ChangeSet} from "./change"

const empty: ReadonlyArray<any> = []

class Meta {
  constructor(from: Meta | null = null) {
    if (from) for (let prop in from) this[prop] = from[prop]
  }
  [key: string]: any
}
Meta.prototype["__proto__"] = null

const metaSlotNames = Object.create(null)

// _T is a phantom type parameter
export class MetaSlot<_T> {
  /** @internal */
  name: string

  constructor(debugName: string = "meta") {
    this.name = unique(debugName, metaSlotNames)
  }

  static time: MetaSlot<number> = new MetaSlot("time")
  static origin: MetaSlot<string> = new MetaSlot("origin")
  static changeTabSize: MetaSlot<number> = new MetaSlot("changeTabSize")
  static changeLineSeparator: MetaSlot<string | null> = new MetaSlot("changeLineSeparator")
  static userEvent: MetaSlot<string> = new MetaSlot("userEvent")
  static addToHistory: MetaSlot<boolean> = new MetaSlot("addToHistory")
}

const FLAG_SELECTION_SET = 1, FLAG_SCROLL_INTO_VIEW = 2

export class Transaction {
  private constructor(readonly startState: EditorState,
                      readonly changes: ChangeSet,
                      readonly docs: ReadonlyArray<Text>,
                      readonly selection: EditorSelection,
                      private readonly meta: Meta,
                      private readonly flags: number) {}

  static start(state: EditorState, time: number = Date.now()) {
    let meta = new Meta
    meta[MetaSlot.time.name] = time
    return new Transaction(state, ChangeSet.empty, empty, state.selection, meta, 0)
  }

  get doc(): Text {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  setMeta<T>(slot: MetaSlot<T>, value: T): Transaction {
    let meta = new Meta(this.meta)
    meta[slot.name] = value
    return new Transaction(this.startState, this.changes, this.docs, this.selection, meta, this.flags)
  }

  getMeta<T>(slot: MetaSlot<T>): T | undefined {
    return this.meta[slot.name] as T
  }

  change(change: Change, mirror?: number): Transaction {
    if (change.from == change.to && change.length == 0) return this
    if (change.from < 0 || change.to < change.from || change.to > this.doc.length)
      throw new RangeError(`Invalid change ${change.from} to ${change.to}`)
    let changes = this.changes.append(change, mirror)
    return new Transaction(this.startState, changes, this.docs.concat(change.apply(this.doc)),
                           this.selection.map(changes.partialMapping(changes.length - 1)),
                           this.meta, this.flags)
  }

  replace(from: number, to: number, text: string | ReadonlyArray<string>): Transaction {
    return this.change(new Change(from, to, typeof text == "string" ? this.startState.splitLines(text) : text))
  }

  replaceSelection(text: string | ReadonlyArray<string>): Transaction {
    let content = typeof text == "string" ? this.startState.splitLines(text) : text
    return this.reduceRanges((state, r) => {
      let change = new Change(r.from, r.to, content)
      return {transaction: state.change(change), range: new SelectionRange(r.from + change.length)}
    })
  }

  reduceRanges(f: (transaction: Transaction, range: SelectionRange) => (Transaction | {transaction: Transaction, range: SelectionRange})): Transaction {
    let tr: Transaction = this
    let sel = tr.selection, start = tr.changes.length, newRanges: SelectionRange[] = []
    for (let range of sel.ranges) {
      range = range.map(tr.changes.partialMapping(start))
      let result = f(tr, range)
      if (result instanceof Transaction) {
        tr = result
        newRanges.push(range.map(tr.changes.partialMapping(tr.changes.length - 1)))
      } else {
        tr = result.transaction
        newRanges.push(result.range)
      }
    }
    return tr.setSelection(EditorSelection.create(newRanges, sel.primaryIndex))
  }

  setSelection(selection: EditorSelection): Transaction {
    return new Transaction(this.startState, this.changes, this.docs, selection, this.meta,
                           this.flags | FLAG_SELECTION_SET)
  }

  get selectionSet(): boolean {
    return (this.flags & FLAG_SELECTION_SET) > 0
  }

  get docChanged(): boolean {
    return this.changes.length > 0
  }

  scrollIntoView(): Transaction {
    return new Transaction(this.startState, this.changes, this.docs, this.selection,
                           this.meta, this.flags | FLAG_SCROLL_INTO_VIEW)
  }

  get scrolledIntoView(): boolean {
    return (this.flags & FLAG_SCROLL_INTO_VIEW) > 0
  }

  apply(): EditorState {
    return this.startState.applyTransaction(this)
  }

  invertedChanges(): ChangeSet<Change> {
    if (!this.changes.length) return ChangeSet.empty
    let changes: Change[] = [], set = this.changes
    for (let i = set.length - 1; i >= 0; i--)
      changes.push(set.changes[i].invert(i == 0 ? this.startState.doc : this.docs[i - 1]))
    return new ChangeSet(changes, set.mirror.length ? set.mirror.map(i => set.length - i - 1) : set.mirror)
  }
}
