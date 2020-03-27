import {combineConfig, EditorState, Transaction, StateField, StateCommand, StateEffect,
        Facet, Extension, ChangeSet, ChangeDesc, EditorSelection} from "../../state"

const enum BranchName { Done, Undone }

// FIXME this would make more sense as an annotation, maybe
const historyMoveEffect = StateEffect.define<{side: BranchName, rest: Branch}>()

/// Transaction effect that will prevent further steps from being
/// appended to an existing history event (so that they require a
/// separate undo command to undo).
export const closeHistory = StateEffect.define()

const none: readonly any[] = []

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
    let config = newState.facet(historyConfig)

    for (let effect of tr.effects) if (effect.is(historyMoveEffect)) {
      let item = Item.fromTransaction(tr), from = effect.value.side
      let other = from == BranchName.Done ? state.undone : state.done
      if (item) other = addChangeItem(other, item, config.minDepth, nope)
      return new HistoryState(from == BranchName.Done ? effect.value.rest : other,
                              from == BranchName.Done ? other : effect.value.rest)
    }

    if (tr.effects.some(e => e.is(closeHistory))) state = state.resetTime()

    if (tr.annotation(Transaction.addToHistory) === false)
      return tr.changes.length ? state.addMapping(tr.changes.desc, config.minDepth) : state

    
    let item = Item.fromTransaction(tr)
    if (!item) return state
    return state.addChangeItem(item, tr.annotation(Transaction.time)!, tr.annotation(Transaction.userEvent),
                               config.newGroupDelay, config.minDepth)
  }
})

/// Create a history extension with the given configuration.
export function history(config: HistoryConfig = {}): Extension {
  return [
    historyField,
    historyConfig.of(config)
  ]
}

function cmd(side: BranchName, only: ItemFilter): StateCommand {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let historyState = state.field(historyField, false)
    if (!historyState || !historyState.canPop(side, only)) return false
    const {transaction, rest} = historyState.pop(side, only, state)
    dispatch(transaction.effect(historyMoveEffect.of({side, rest})))
    return true
  }
}

/// Undo a single group of history events. Returns false if no group
/// was available.
export const undo = cmd(BranchName.Done, ItemFilter.OnlyChanges)
/// Redo a group of history events. Returns false if no group was
/// available.
export const redo = cmd(BranchName.Undone, ItemFilter.OnlyChanges)

/// Undo a selection change.
export const undoSelection = cmd(BranchName.Done, ItemFilter.Any)

/// Redo a selection change.
export const redoSelection = cmd(BranchName.Undone, ItemFilter.Any)

function depth(side: BranchName, only: ItemFilter) {
  return function(state: EditorState): number {
    let histState = state.field(historyField, false)
    return histState ? histState.eventCount(side, only) : 0
  }
}

/// The amount of undoable change events available in a given state.
export const undoDepth = depth(BranchName.Done, ItemFilter.OnlyChanges)
/// The amount of redoable change events available in a given state.
export const redoDepth = depth(BranchName.Undone, ItemFilter.OnlyChanges)
/// The amount of undoable events available in a given state.
export const redoSelectionDepth = depth(BranchName.Done, ItemFilter.Any)
/// The amount of redoable events available in a given state.
export const undoSelectionDepth = depth(BranchName.Undone, ItemFilter.Any)

class Item {
  constructor(
    // The forward position mapping for this item. Some items _only_
    // have a mapping, and nothing else. These indicate the place of
    // changes that can't be undone.
    readonly map: ChangeSet<ChangeDesc>,
    // The inverted changes that make up this item, if any. Will be
    // null for map-only or selection-only items. Will hold the empty
    // change set for items that have no changes but do have events.
    readonly inverted: ChangeSet | null = null,
    // The inverted effects that are associated with these changes.
    // Only significant when inverted != null.
    readonly effects: readonly StateEffect<any>[] = none,
    // The selection before this item (or after its inverted version).
    readonly selection: EditorSelection | null = null
  ) {}

  get isChange(): boolean { return this.inverted != null }

  merge(other: Item) {
    let map = this.map.appendSet(other.map)
    return this.isChange
      ? new Item(map, other.inverted!.appendSet(this.inverted!),
                 other.effects.length ? other.effects.concat(this.effects) : this.effects, this.selection)
      : new Item(map, null, none, this.selection)
  }

  // This does not check `addToHistory` and such, it assumes the
  // transaction needs to be converted to an item. Returns null when
  // there are no changes or effects or selection changes in the
  // transaction.
  static fromTransaction(tr: Transaction) {
    let effects = []
    let inverted: ChangeSet | null = tr.invertedChanges()
    for (let i = tr.effects.length, effect; i >= 0; i--) if ((effect = tr.effects[i]) && effect.type.history) {
      let mapped = effect.map(inverted)
      // FIXME using the original state as reference will fall apart
      // when other effect before this one change the state somehow
      if (mapped) effects.push(mapped.invert(tr.startState))
    }
    if (!effects.length && !inverted.length) {
      if (!tr.selectionSet) return null
      inverted = null
    }
    return new Item(tr.changes.desc, inverted, effects.length ? effects : none, tr.startState.selection)
  }
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

function addChangeItem(branch: Branch, item: Item, maxLen: number,
                       mayMerge: (prevItem: Item) => boolean): Branch {
  if (branch.length) {
    const lastItem = branch[branch.length - 1]
    if (lastItem.selection && lastItem.isChange == item.isChange && mayMerge(lastItem))
      return updateBranch(branch, branch.length - 1, maxLen, lastItem.merge(item))
  }
  return updateBranch(branch, branch.length, maxLen, item)
}

function popChanges(branch: Branch, only: ItemFilter): {
  changes: ChangeSet,
  effects: readonly StateEffect<any>[],
  branch: Branch,
  selection: EditorSelection
} {
  let map: ChangeSet<ChangeDesc> | null = null
  let idx = branch.length - 1
  for (;; idx--) {
    if (idx < 0) throw new RangeError("popChanges called on empty branch")
    let entry = branch[idx]
    if (entry.isChange || (only == ItemFilter.Any && entry.selection)) break
    map = map ? entry.map.appendSet(map) : entry.map
  }

  let changeItem = branch[idx]
  let newBranch = branch.slice(0, idx)
  let changes = changeItem.inverted || ChangeSet.empty
  let effects = changeItem.effects
  let selection = changeItem.selection!

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
    changes = new ChangeSet(mappedChanges)

    let mappedEffects = []
    for (let effect of effects) {
      let mapped = effect.map(map)
      if (mapped) mappedEffects.push(mapped)
    }
    effects = mappedEffects
    
    selection = selection.map(map)
  }
  return {changes, effects, branch: newBranch, selection}
}

function nope() { return false }

function eqSelectionShape(a: EditorSelection, b: EditorSelection) {
  return a.ranges.length == b.ranges.length &&
         a.ranges.filter((r, i) => r.empty != b.ranges[i].empty).length === 0
}

class HistoryState {
  constructor(public readonly done: Branch,
              public readonly undone: Branch,
              private readonly prevTime: number | null = null,
              private readonly prevUserEvent: string | undefined = undefined) {}

  resetTime(): HistoryState {
    return new HistoryState(this.done, this.undone)
  }

  addChangeItem(item: Item, time: number, userEvent: string | undefined,
                newGroupDelay: number, maxLen: number): HistoryState {
    let mayMerge: (item: Item) => boolean = nope
    if (this.prevTime !== null && time - this.prevTime < newGroupDelay &&
        (item.isChange || (this.prevUserEvent == userEvent && userEvent == "keyboard")))
      mayMerge = item.isChange
                 ? prev => isAdjacent(prev.map.changes[prev.map.length - 1], item.map.changes[0])
                 : prev => eqSelectionShape(prev.selection!, item.selection!)
    return new HistoryState(addChangeItem(this.done, item, maxLen, mayMerge), this.undone, time, userEvent)
  }

  addMapping(map: ChangeSet<ChangeDesc>, maxLen: number): HistoryState {
    if (this.done.length == 0) return this
    return new HistoryState(updateBranch(this.done, this.done.length, maxLen, new Item(map)), this.undone)
  }

  canPop(done: BranchName, only: ItemFilter): boolean {
    const target = done == BranchName.Done ? this.done : this.undone
    for (const {isChange, selection} of target)
      if (isChange || (only == ItemFilter.Any && selection)) return true
    return false
  }

  pop(done: BranchName, only: ItemFilter, state: EditorState): {transaction: Transaction, rest: Branch} {
    let {changes, effects, branch, selection} = popChanges(done == BranchName.Done ? this.done : this.undone, only)

    let tr = state.t()
    for (let change of changes.changes) tr.change(change)
    for (let effect of effects) tr.effect(effect)
    tr.setSelection(selection)
    return {transaction: tr, rest: branch}
  }

  eventCount(done: BranchName, only: ItemFilter) {
    let count = 0, branch = done == BranchName.Done ? this.done : this.undone
    for (const {isChange, selection} of branch)
      if (isChange || (only == ItemFilter.Any && selection)) ++count
    return count
  }

  static empty: HistoryState = new HistoryState([], [])
}
