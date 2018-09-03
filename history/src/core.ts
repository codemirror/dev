import {ChangeSet, ChangeDesc, Transaction, EditorSelection} from "../../state/src"

class Item {
  constructor(readonly map: ChangeSet<ChangeDesc>,
              readonly inverted: ChangeSet | null = null,
              readonly selection: EditorSelection | null = null) {}
  get isChange(): boolean { return this.inverted != null }
}

type Branch = ReadonlyArray<Item>

function updateBranch(branch: Branch, to: number, maxLen: number, newItem: Item) {
  let start = to + 1 > maxLen + 20 ? to - maxLen - 1 : 0
  let newBranch = branch.slice(start, to)
  newBranch.push(newItem)
  return newBranch
}

function addChanges(branch: Branch, changes: ChangeSet, inverted: ChangeSet,
                    selectionBefore: EditorSelection, maxLen: number,
                    mayMerge: (prevChange: ChangeDesc | null, curChange: ChangeDesc) => boolean): Branch {
  let lastItem
  if (branch.length && (lastItem = branch[branch.length - 1]).isChange &&
      mayMerge(lastItem.map.changes[lastItem.map.length - 1], changes.changes[0]))
    return updateBranch(branch, branch.length - 1, maxLen,
                        new Item(lastItem.map.appendSet(changes.desc), inverted.appendSet(lastItem.inverted!), lastItem.selection))
  return updateBranch(branch, branch.length, maxLen, new Item(changes.desc, inverted, selectionBefore))
}

function popChanges(branch: Branch): {changes: ChangeSet, branch: Branch, selection: EditorSelection} {
  let map: ChangeSet<ChangeDesc> | null = null
  let idx = branch.length - 1
  for (;; idx--) {
    if (idx < 0) throw new RangeError("popChanges called on empty branch")
    let entry = branch[idx]
    if (entry.isChange) break
    map = map ? entry.map.appendSet(map) : entry.map
  }

  let changeItem = branch[idx]
  let newBranch = branch.slice(0, idx), changes = changeItem.inverted!, selection = changeItem.selection!

  if (map) {
    let startIndex = changeItem.map.length
    map = changeItem.map.appendSet(map)
    let mappedChanges = []
    for (let i = 0; i < changeItem.inverted!.length; i++) {
      let mapped = changeItem.inverted!.changes[i].map(map.partialMapping(startIndex - i))
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

export const enum PopTarget { Done, Undone }

export class HistoryState {
  private constructor(public readonly done: Branch,
                      public readonly undone: Branch,
                      private readonly prevTime: number | null = null) {}

  resetTime(): HistoryState {
    return new HistoryState(this.done, this.undone)
  }

  addChanges(changes: ChangeSet, inverted: ChangeSet, selection: EditorSelection,
             mayMerge: (prevChange: ChangeDesc | null, curChange: ChangeDesc) => boolean, time: number,
             newGroupDelay: number, maxLen: number): HistoryState {
    if (changes.length == 0) return this
    return new HistoryState(addChanges(this.done, changes, inverted, selection, maxLen,
                                       this.prevTime !== null && time - this.prevTime < newGroupDelay ? mayMerge : nope),
                            this.undone, time)
  }

  addMapping(map: ChangeSet<ChangeDesc>, maxLen: number): HistoryState {
    if (this.done.length == 0) return this
    return new HistoryState(updateBranch(this.done, this.done.length, maxLen, new Item(map)), this.undone)
  }

  canPop(done: PopTarget): boolean {
    return (done == PopTarget.Done ? this.done : this.undone).length > 0
  }

  pop(done: PopTarget, transaction: Transaction, maxLen: number): {transaction: Transaction, state: HistoryState} {
    let {changes, branch, selection} = popChanges(done == PopTarget.Done ? this.done : this.undone)

    let oldSelection = transaction.selection
    for (let change of changes.changes) transaction = transaction.change(change)
    transaction = transaction.setSelection(selection)
    let otherBranch = (done == PopTarget.Done ? this.undone : this.done)
    if (changes.length) otherBranch = addChanges(otherBranch, transaction.changes, transaction.invertedChanges(), oldSelection, maxLen, nope)
    return {transaction, state: new HistoryState(done == PopTarget.Done ? branch : otherBranch,
                                                 done == PopTarget.Done ? otherBranch : branch)}
  }

  eventCount(done: PopTarget) {
    let count = 0, branch = done == PopTarget.Done ? this.done : this.undone
    for (let i = 0; i < branch.length; ++i) if (branch[i].isChange) ++count
    return count
  }

  static empty: HistoryState = new HistoryState([], [])
}
