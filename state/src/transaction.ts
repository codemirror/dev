import {Text} from "../../doc/src"
import {Slot, SlotType} from "../../extension/src/extension"
import {EditorState} from "./state"
import {EditorSelection, SelectionRange} from "./selection"
import {Change, ChangeSet} from "./change"

const empty: ReadonlyArray<any> = []

const FLAG_SELECTION_SET = 1, FLAG_SCROLL_INTO_VIEW = 2

export class Transaction {
  private constructor(readonly startState: EditorState,
                      readonly changes: ChangeSet,
                      readonly docs: ReadonlyArray<Text>,
                      readonly selection: EditorSelection,
                      private readonly metadata: ReadonlyArray<Slot>,
                      private readonly flags: number) {}

  static start(state: EditorState, time: number = Date.now()) {
    return new Transaction(state, ChangeSet.empty, empty, state.selection, [Transaction.time(time)], 0)
  }

  get doc(): Text {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  addMeta(...metadata: Slot[]): Transaction {
    return new Transaction(this.startState, this.changes, this.docs, this.selection, this.metadata.concat(metadata), this.flags)
  }

  getMeta<T>(type: SlotType<T>): T | undefined {
    return Slot.get(type, this.metadata)
  }

  change(change: Change, mirror?: number): Transaction {
    if (change.from == change.to && change.length == 0) return this
    if (change.from < 0 || change.to < change.from || change.to > this.doc.length)
      throw new RangeError(`Invalid change ${change.from} to ${change.to}`)
    let changes = this.changes.append(change, mirror)
    return new Transaction(this.startState, changes, this.docs.concat(change.apply(this.doc)),
                           this.selection.map(changes.partialMapping(changes.length - 1)),
                           this.metadata, this.flags)
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

  mapRanges(f: (range: SelectionRange) => SelectionRange): Transaction {
    return this.reduceRanges((tr, range) => ({transaction: tr, range: f(range)}))
  }

  setSelection(selection: EditorSelection): Transaction {
    return new Transaction(this.startState, this.changes, this.docs,
                           this.startState.multipleSelections ? selection : selection.asSingle(),
                           this.metadata, this.flags | FLAG_SELECTION_SET)
  }

  get selectionSet(): boolean {
    return (this.flags & FLAG_SELECTION_SET) > 0
  }

  get docChanged(): boolean {
    return this.changes.length > 0
  }

  scrollIntoView(): Transaction {
    return new Transaction(this.startState, this.changes, this.docs, this.selection,
                           this.metadata, this.flags | FLAG_SCROLL_INTO_VIEW)
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

  static time = Slot.define<number>()
  static changeTabSize = Slot.define<number>()
  static changeLineSeparator = Slot.define<string | null>()
  static preserveGoalColumn = Slot.define<boolean>()
  static userEvent = Slot.define<string>()
  static addToHistory = Slot.define<boolean>()
}
