import {Text} from "../../doc/src"
import {Slot, SlotType} from "../../extension/src/extension"
import {EditorState} from "./state"
import {EditorSelection, SelectionRange} from "./selection"
import {Change, ChangeSet} from "./change"

const FLAG_SELECTION_SET = 1, FLAG_SCROLL_INTO_VIEW = 2

export class Transaction {
  changes: ChangeSet = ChangeSet.empty
  docs: Text[] = []
  selection: EditorSelection
  private metadata: Slot[]
  private flags: number = 0
  private state: EditorState | null = null

  constructor(readonly startState: EditorState, time: number = Date.now()) {
    this.selection = startState.selection
    this.metadata = [Transaction.time(time)]
  }

  get doc(): Text {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  addMeta(...metadata: Slot[]): Transaction {
    this.ensureOpen()
    for (let slot of metadata) this.metadata.push(slot)
    return this
  }

  getMeta<T>(type: SlotType<T>): T | undefined {
    return Slot.get(type, this.metadata)
  }

  change(change: Change, mirror?: number): Transaction {
    this.ensureOpen()
    if (change.from == change.to && change.length == 0) return this
    if (change.from < 0 || change.to < change.from || change.to > this.doc.length)
      throw new RangeError(`Invalid change ${change.from} to ${change.to}`)
    this.changes = this.changes.append(change, mirror)
    this.docs.push(change.apply(this.doc))
    this.selection = this.selection.map(change)
    return this
  }

  replace(from: number, to: number, text: string | ReadonlyArray<string>): Transaction {
    return this.change(new Change(from, to, typeof text == "string" ? this.startState.splitLines(text) : text))
  }

  replaceSelection(text: string | ReadonlyArray<string>): Transaction {
    let content = typeof text == "string" ? this.startState.splitLines(text) : text
    return this.forEachRange(range => {
      let change = new Change(range.from, range.to, content)
      this.change(change)
      return new SelectionRange(range.from + change.length)
    })
  }

  forEachRange(f: (range: SelectionRange, tr: Transaction) => SelectionRange): Transaction {
    let sel = this.selection, start = this.changes.length, newRanges: SelectionRange[] = []
    for (let range of sel.ranges) {
      let before = this.changes.length
      let result = f(range.map(this.changes.partialMapping(start)), this)
      if (this.changes.length > before) {
        let mapping = this.changes.partialMapping(before)
        for (let i = 0; i < newRanges.length; i++) newRanges[i] = newRanges[i].map(mapping)
      }
      newRanges.push(result)
    }
    return this.setSelection(EditorSelection.create(newRanges, sel.primaryIndex))
  }

  setSelection(selection: EditorSelection): Transaction {
    this.ensureOpen()
    this.selection = this.startState.multipleSelections ? selection : selection.asSingle()
    this.flags |= FLAG_SELECTION_SET
    return this
  }

  get selectionSet(): boolean {
    return (this.flags & FLAG_SELECTION_SET) > 0
  }

  get docChanged(): boolean {
    return this.changes.length > 0
  }

  scrollIntoView(): Transaction {
    this.ensureOpen()
    this.flags |= FLAG_SCROLL_INTO_VIEW
    return this
  }

  get scrolledIntoView(): boolean {
    return (this.flags & FLAG_SCROLL_INTO_VIEW) > 0
  }

  private ensureOpen() {
    if (this.state) throw new Error("Transactions may not be modified after being applied")
  }

  apply(): EditorState {
    return this.state || (this.state = this.startState.applyTransaction(this))
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
