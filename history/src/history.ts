import {combineConfig, EditorState, Transaction, StateField, StateCommand,
        Annotation, Facet, Extension, ChangeSet, ChangeDesc, EditorSelection} from "../../state"

const historyStateAnnotation = Annotation.define<HistoryState>()

const closeHistoryAnnotation = Annotation.define<boolean>()

/// Options given when creating a history extension.
export interface HistoryConfig {
  /// The minimum depth (amount of events) to store. Defaults to 100.
  minDepth?: number,
  /// The maximum time (in milliseconds) that adjacent events can be
  /// apart and still be grouped together. Defaults to 500.
  newGroupDelay?: number
}

const historyConfig = Facet.define<HistoryConfig, Required<HistoryConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      minDepth: 100,
      newGroupDelay: 500
    }, {minDepth: Math.max, newGroupDelay: Math.min})
  }
})

const historyField = StateField.define({
  create() {
    return HistoryState.empty
  },

  update(state: HistoryState, tr: Transaction, newState: EditorState): HistoryState {
    const fromMeta = tr.annotation(historyStateAnnotation)
    if (fromMeta) return fromMeta
    if (tr.annotation(closeHistoryAnnotation)) state = state.resetTime()
    if (!tr.changes.length && !tr.selectionSet) return state

    let config = newState.facet(historyConfig)
    if (tr.annotation(Transaction.addToHistory) !== false)
      return state.addChanges(tr.changes, tr.changes.length ? tr.invertedChanges() : null,
                              tr.startState.selection, tr.annotation(Transaction.time)!,
                              tr.annotation(Transaction.userEvent), config.newGroupDelay, config.minDepth)
    return state.addMapping(tr.changes.desc, config.minDepth)
  }
})

/// Create a history extension with the given configuration.
export function history(config: HistoryConfig = {}): Extension {
  return [
    historyField,
    historyConfig.of(config)
  ]
}

function cmd(target: PopTarget, only: ItemFilter): StateCommand {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let config = state.facet(historyConfig)
    let historyState = state.field(historyField, false)
    if (!historyState || !historyState.canPop(target, only)) return false
    const {transaction, state: newState} = historyState.pop(target, only, state.t(), config.minDepth)
    dispatch(transaction.annotate(historyStateAnnotation, newState))
    return true
  }
}

/// Undo a single group of history events. Returns false if no group
/// was available.
export const undo = cmd(PopTarget.Done, ItemFilter.OnlyChanges)
/// Redo a group of history events. Returns false if no group was
/// available.
export const redo = cmd(PopTarget.Undone, ItemFilter.OnlyChanges)

/// Undo a selection change.
export const undoSelection = cmd(PopTarget.Done, ItemFilter.Any)

/// Redo a selection change.
export const redoSelection = cmd(PopTarget.Undone, ItemFilter.Any)

/// Set a flag on the given transaction that will prevent further steps
/// from being appended to an existing history event (so that they
/// require a separate undo command to undo).
export function closeHistory(tr: Transaction): Transaction {
  return tr.annotate(closeHistoryAnnotation, true)
}

function depth(target: PopTarget, only: ItemFilter) {
  return function(state: EditorState): number {
    let histState = state.field(historyField, false)
    return histState ? histState.eventCount(target, only) : 0
  }
}

/// The amount of undoable change events available in a given state.
export const undoDepth = depth(PopTarget.Done, ItemFilter.OnlyChanges)
/// The amount of redoable change events available in a given state.
export const redoDepth = depth(PopTarget.Undone, ItemFilter.OnlyChanges)
/// The amount of undoable events available in a given state.
export const redoSelectionDepth = depth(PopTarget.Done, ItemFilter.Any)
/// The amount of redoable events available in a given state.
export const undoSelectionDepth = depth(PopTarget.Undone, ItemFilter.Any)

class Item {
  constructor(readonly map: ChangeSet<ChangeDesc>,
              readonly inverted: ChangeSet | null = null,
              readonly selection: EditorSelection | null = null) {}
  get isChange(): boolean { return this.inverted != null }
}
const enum ItemFilter { OnlyChanges, Any }

type Branch = readonly Item[]

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
    if (lastItem.selection && lastItem.isChange == Boolean(inverted) && mayMerge(lastItem)) {
      if (!inverted) return branch
      let item = new Item(lastItem.map.appendSet(changes.desc), inverted.appendSet(lastItem.inverted!), lastItem.selection)
      return updateBranch(branch, branch.length - 1, maxLen, item)
    }
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

const enum PopTarget { Done, Undone }

class HistoryState {
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

  pop(
    done: PopTarget, only: ItemFilter, transaction: Transaction, maxLen: number
  ): {transaction: Transaction, state: HistoryState} {
    let {changes, branch, selection} = popChanges(done == PopTarget.Done ? this.done : this.undone, only)

    let oldSelection = transaction.selection
    for (let change of changes.changes) transaction.change(change)
    transaction.setSelection(selection)
    let otherBranch = (done == PopTarget.Done ? this.undone : this.done)
    otherBranch = addChanges(otherBranch, transaction.changes,
                             transaction.changes.length > 0 ? transaction.invertedChanges() : null, oldSelection, maxLen, nope)
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
