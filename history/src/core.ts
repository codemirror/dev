import {ChangeSet, ChangeDesc, Transaction, EditorSelection} from "../../state/src"

class Item {
  constructor(readonly map: ChangeSet<ChangeDesc>,
              readonly inverted: ChangeSet | null = null,
              readonly selection: EditorSelection | null = null) {}
  get isChange(): boolean { return this.inverted != null }
}
export const enum ItemFilter { OnlyChanges, Any }

type Branch = ReadonlyArray<Item>

function updateBranch(branch: Branch, to: number, maxLen: number, newItem: Item) {
  let start = to + 1 > maxLen + 20 ? to - maxLen - 1 : 0
  let newBranch = branch.slice(start, to)
  newBranch.push(newItem)
  return newBranch
}

function isAdjacent(prev: ChangeDesc | null, cur: ChangeDesc): boolean {
  return !!prev && cur.from <= prev.mapPos(prev.to, 1) && cur.to >= prev.mapPos(prev.from)
}

function addChanges(branch: Branch, changes: ChangeSet, inverted: ChangeSet | null,
                    selectionBefore: EditorSelection, maxLen: number,
                    mayMerge: (prevItem: Item) => boolean): Branch {
  if (branch.length) {
    const lastItem = branch[branch.length - 1]
    if (lastItem.selection && lastItem.isChange == Boolean(inverted) && mayMerge(lastItem))
      return inverted ? updateBranch(branch, branch.length - 1, maxLen, new Item(lastItem.map.appendSet(changes.desc), inverted.appendSet(lastItem.inverted!), lastItem.selection)) : branch
  }
  return updateBranch(branch, branch.length, maxLen, new Item(changes.desc, inverted, selectionBefore))
}

function popChanges(branch: Branch, only: ItemFilter): {changes: ChangeSet, branch: Branch, selection: EditorSelection} {
  let map: ChangeSet<ChangeDesc> | null = null
  let idx = branch.length - 1
  for (;; idx--) {
    if (idx < 0) throw new RangeError("popChanges called on empty branch")
    let entry = branch[idx]
    if (entry.isChange || (only == ItemFilter.Any && entry.selection)) break
    map = map ? entry.map.appendSet(map) : entry.map
  }

  let changeItem = branch[idx]
  let newBranch = branch.slice(0, idx), changes = changeItem.inverted || ChangeSet.empty, selection = changeItem.selection!

  if (map) {
    let startIndex = changeItem.map.length
    map = changeItem.map.appendSet(map)
    let mappedChanges = []
    for (let i = 0; i < changes.length; i++) {
      let mapped = changes.changes[i].map(map.partialMapping(startIndex - i))
      if (mapped) {
        map = map.append(mapped.desc)
        mappedChanges.push(mapped)
      }
    }
    newBranch.push(new Item(map))
    changes = new ChangeSet(mappedChanges) // FIXME preserve mirror data?
    selection = selection.map(map)
  }
  return {changes, branch: newBranch, selection}
}

function nope() { return false }

function eqSelectionShape(a: EditorSelection, b: EditorSelection) {
  return a.ranges.length == b.ranges.length &&
         a.ranges.filter((r, i) => r.empty != b.ranges[i].empty).length === 0
}

export const enum PopTarget { Done, Undone }

export class HistoryState {
  private constructor(public readonly done: Branch,
                      public readonly undone: Branch,
                      private readonly prevTime: number | null = null,
                      private readonly prevUserEvent: string | undefined = undefined) {}

  resetTime(): HistoryState {
    return new HistoryState(this.done, this.undone)
  }

  addChanges(changes: ChangeSet, inverted: ChangeSet | null, selection: EditorSelection,
             time: number, userEvent: string | undefined, newGroupDelay: number, maxLen: number): HistoryState {
    let mayMerge: (item: Item) => boolean = nope
    if (this.prevTime !== null && time - this.prevTime < newGroupDelay &&
        (inverted || (this.prevUserEvent == userEvent && userEvent == "keyboard")))
      mayMerge = inverted
                 ? prev => isAdjacent(prev.map.changes[prev.map.length - 1], changes.changes[0])
                 : prev => eqSelectionShape(prev.selection!, selection)
    return new HistoryState(addChanges(this.done, changes, inverted, selection, maxLen, mayMerge),
                            this.undone, time, userEvent)
  }

  addMapping(map: ChangeSet<ChangeDesc>, maxLen: number): HistoryState {
    if (this.done.length == 0) return this
    return new HistoryState(updateBranch(this.done, this.done.length, maxLen, new Item(map)), this.undone)
  }

  canPop(done: PopTarget, only: ItemFilter): boolean {
    const target = done == PopTarget.Done ? this.done : this.undone
    for (const {isChange, selection} of target)
      if (isChange || (only == ItemFilter.Any && selection)) return true
    return false
  }

  pop(done: PopTarget, only: ItemFilter, transaction: Transaction, maxLen: number): {transaction: Transaction, state: HistoryState} {
    let {changes, branch, selection} = popChanges(done == PopTarget.Done ? this.done : this.undone, only)

    let oldSelection = transaction.selection
    for (let change of changes.changes) transaction.change(change)
    transaction.setSelection(selection)
    let otherBranch = (done == PopTarget.Done ? this.undone : this.done)
    otherBranch = addChanges(otherBranch, transaction.changes, transaction.changes.length > 0 ? transaction.invertedChanges() : null, oldSelection, maxLen, nope)
    return {transaction, state: new HistoryState(done == PopTarget.Done ? branch : otherBranch,
                                                 done == PopTarget.Done ? otherBranch : branch)}
  }

  eventCount(done: PopTarget, only: ItemFilter) {
    let count = 0, branch = done == PopTarget.Done ? this.done : this.undone
    for (const {isChange, selection} of branch)
      if (isChange || (only == ItemFilter.Any && selection)) ++count
    return count
  }

  static empty: HistoryState = new HistoryState([], [])
}
