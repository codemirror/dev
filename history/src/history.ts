import {combineConfig, EditorState, Transaction, StateField, StateCommand, StateEffect,
        Facet, Annotation, Extension, ChangeSet, Change, ChangeDesc, EditorSelection} from "@codemirror/next/state"

const enum BranchName { Done, Undone }

const fromHistory = Annotation.define<{side: BranchName, rest: Branch}>()

/// Transaction annotation that will prevent that annotation from
/// being combined with other annotations in the undo history. Given
/// `"before"`, it'll prevent merging with previous transactions. With
/// `"after"`, subsequent transactions won't be combined with this
/// one. With `"full"`, the transaction is isolated on both sides.
export const isolateHistory = Annotation.define<"before" | "after" | "full">()

/// This facet provides a way to register functions that, given a
/// transaction, provide a set of effects that the history should
/// store when inverting the transaction. This can be used to
/// integrate some kinds of effects in the history, so that they can
/// be undone (and redone again).
export const invertedEffects = Facet.define<(tr: Transaction) => readonly StateEffect<any>[]>()

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

    let fromHist = tr.annotation(fromHistory)
    if (fromHist) {
      let item = HistEvent.fromTransaction(tr), from = fromHist.side
      let other = from == BranchName.Done ? state.undone : state.done
      if (item) other = updateBranch(other, other.length, config.minDepth, item)
      else other = addSelection(other, tr.startState.selection)
      return new HistoryState(from == BranchName.Done ? fromHist.rest : other,
                              from == BranchName.Done ? other : fromHist.rest)
    }

    let isolate = tr.annotation(isolateHistory)
    if (isolate == "full" || isolate == "before") state = state.isolate()

    if (tr.annotation(Transaction.addToHistory) === false)
      return tr.changes.length ? state.addMapping(tr.changes.desc) : state
    
    let event = HistEvent.fromTransaction(tr)
    let time = tr.annotation(Transaction.time)!, userEvent = tr.annotation(Transaction.userEvent)
    if (event)
      state = state.addChanges(event, time, userEvent, config.newGroupDelay, config.minDepth)
    else if (tr.selectionSet)
      state = state.addSelection(tr.startState.selection, time, userEvent, config.newGroupDelay)

    if (isolate == "full" || isolate == "after") state = state.isolate()
    return state
  }
})

/// Create a history extension with the given configuration.
export function history(config: HistoryConfig = {}): Extension {
  return [
    historyField,
    historyConfig.of(config)
  ]
}

function cmd(side: BranchName, selection: boolean): StateCommand {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let historyState = state.field(historyField, false)
    if (!historyState) return false
    let tr = historyState.pop(side, state, selection)
    if (!tr) return false
    dispatch(tr)
    return true
  }
}

/// Undo a single group of history events. Returns false if no group
/// was available.
export const undo = cmd(BranchName.Done, false)
/// Redo a group of history events. Returns false if no group was
/// available.
export const redo = cmd(BranchName.Undone, false)

/// Undo a selection change.
export const undoSelection = cmd(BranchName.Done, true)

/// Redo a selection change.
export const redoSelection = cmd(BranchName.Undone, true)

function depth(side: BranchName) {
  return function(state: EditorState): number {
    let histState = state.field(historyField, false)
    if (!histState) return 0
    let branch = side == BranchName.Done ? histState.done : histState.undone
    return branch.length - (branch.length && !branch[0].isChange ? 1 : 0)
  }
}

/// The amount of undoable change events available in a given state.
export const undoDepth = depth(BranchName.Done)
/// The amount of redoable change events available in a given state.
export const redoDepth = depth(BranchName.Undone)

// Event mappings store the way an event _has been_ mapped, which
// means events below it need to also be mapped.
class EventMapping {
  constructor(
    // A mapping that contains the event's _original_ (before any
    // mapping) forward changes (up to `local`), followed by the
    // externally added mapping, followed by the event's mapped,
    // inverted changes.
    readonly mapping: ChangeSet<ChangeDesc>,
    readonly end: number,
    // The amount of changes (at the start of the mapping) that are
    // local to this event.
    readonly local: number
  ) {}
}

// History events store groups of changes or effects that need to be
// undone/redone together.
class HistEvent {
  constructor(
    // The changes in this event
    readonly changes: readonly Change[],
    // The effects associated with this event
    readonly effects: readonly StateEffect<any>[],
    readonly mapped: EventMapping | null,
    // Normal events hold at least one change or effect. But it may be
    // necessary to store selection events before the first change, in
    // which case special type of instance is created which doesn't
    // hold any changes, and with startSelection == null
    readonly startSelection: EditorSelection | null,
    // Stores selection changes after this event, to be used for
    // selection undo/redo.
    readonly selectionsAfter: readonly EditorSelection[]
  ) {}

  get isChange() { return this.startSelection != null }

  setSelAfter(after: readonly EditorSelection[]) {
    return new HistEvent(this.changes, this.effects, this.mapped, this.startSelection, after)
  }

  // This does not check `addToHistory` and such, it assumes the
  // transaction needs to be converted to an item. Returns null when
  // there are no changes or effects in the transaction.
  static fromTransaction(tr: Transaction) {
    let effects: readonly StateEffect<any>[] = none
    for (let invert of tr.startState.facet(invertedEffects)) {
      let result = invert(tr)
      if (result.length) effects = effects.concat(result)
    }
    if (!effects.length && !tr.changes.length) return null
    let inverted: ChangeSet | null = tr.invertedChanges() // FIXME make this return an array?
    return new HistEvent(inverted.changes, effects, null, tr.startState.selection, none)
  }
}

type Branch = readonly HistEvent[]

function updateBranch(branch: Branch, to: number, maxLen: number, newEvent: HistEvent) {
  let start = to + 1 > maxLen + 20 ? to - maxLen - 1 : 0
  let newBranch = branch.slice(start, to)
  newBranch.push(newEvent)
  return newBranch
}

function isAdjacent(a: ChangeDesc, b: ChangeDesc): boolean {
  return a.from <= b.from + b.length && a.to >= b.from
}

function eqSelectionShape(a: EditorSelection, b: EditorSelection) {
  return a.ranges.length == b.ranges.length &&
         a.ranges.filter((r, i) => r.empty != b.ranges[i].empty).length === 0
}

function conc<T>(a: readonly T[], b: readonly T[]) {
  return !a.length ? b : !b.length ? a : a.concat(b)
}

const none: readonly any[] = []

const MaxSelectionsPerEvent = 200, MaxMappingPerEvent = 200

function addSelection(branch: Branch, selection: EditorSelection) {
  if (!branch.length) {
    return [new HistEvent(none, none, null, null, [selection])]
  } else {
    let lastEvent = branch[branch.length - 1]
    let sels = lastEvent.selectionsAfter.slice(Math.max(0, lastEvent.selectionsAfter.length - MaxSelectionsPerEvent))
    if (sels.length && sels[sels.length - 1].eq(selection)) return branch
    sels.push(selection)
    return updateBranch(branch, branch.length - 1, 1e9, lastEvent.setSelAfter(sels))
  }
}

// Assumes the top item has one or more selectionAfter values
function popSelection(branch: Branch): Branch {
  let last = branch[branch.length - 1]
  let newBranch = branch.slice()
  newBranch[branch.length - 1] = last.setSelAfter(last.selectionsAfter.slice(0, last.selectionsAfter.length - 1))
  return newBranch
}

// Add a mapping to the top event in the given branch. If this maps
// away all the changes and effects in that item, drop it and
// propagate the mapping to the next item.
function addMappingToBranch(branch: Branch, mapping: EventMapping) {
  if (!branch.length) return branch
  let length = branch.length, selections = none
  while (length) {
    let event = mapEvent(branch[length - 1], mapping, selections)
    if (event.changes.length || event.effects.length) { // Event survived mapping
      let result = branch.slice(0, length)
      result[length - 1] = event
      return event.mapped!.mapping.length > MaxMappingPerEvent ? compressBranch(result) : result
    } else { // Drop this event, since there's no changes or effects left
      mapping = event.mapped!
      length--
      selections = event.selectionsAfter
    }
  }
  return selections.length ? [new HistEvent(none, none, null, null, selections)] : none
}

function mapEvent(event: HistEvent, newMapping: EventMapping,
                  extraSelections: readonly EditorSelection[]) {
  let {mapping} = newMapping
  let selections = conc(event.selectionsAfter.length ? event.selectionsAfter.map(s => s.map(mapping)) : none,
                        extraSelections)
  // Change-less events don't store mappings (they are always the last event in a branch)
  if (!event.isChange) return new HistEvent(none, none, null, null, selections)

  // To map this event's changes, create a mapping that includes this
  // event's forward changes and the new changes from the given
  // mapping.
  let forward = event.mapped ? event.mapped.mapping.changes.slice(0, event.mapped.local)
    : event.changes.map(ch => ch.invertedDesc).reverse()
  let local = new ChangeSet(forward).appendSet(mapping)

  let  newChanges: Change[] = [], mapFrom = forward.length
  for (let change of event.changes) {
    let mapped = change.map(local.partialMapping(mapFrom))
    mapFrom--
    if (mapped) {
      newChanges.push(mapped)
      local = local.append(mapped, mapFrom)
    }
  }
  let effects: StateEffect<any>[] = event.effects.length ? [] : none as StateEffect<any>[]
  for (let effect of event.effects) {
    let mapped = effect.map(local)
    if (mapped) effects.push(mapped)
  }

  let eventMapping: EventMapping, prev = event.mapped
  if (prev) {
    let changes = prev.mapping.changes.slice(0, prev.end).concat(mapping.changes).concat(newChanges.map(ch => ch.desc))
    let mirror = mapping.mirror.map(i => i + prev!.end)
    for (let i = 0; i < prev.mapping.mirror.length; i += 2) {
      let a = prev.mapping.mirror[i], b = prev.mapping.mirror[i + 1]
      if (a > prev.local && b > prev.local) mirror.push(a, b)
    }
    for (let i = 0; i < forward.length; i++) {
      let found = local.getMirror(i)
      if (found != null) mirror.push(i, changes.length - (local.length - found))
    }
    eventMapping = new EventMapping(new ChangeSet(changes, mirror), changes.length - newChanges.length, forward.length)
  } else {
    eventMapping = new EventMapping(local, local.length - newChanges.length, forward.length)
  }
  return new HistEvent(newChanges, effects, eventMapping, event.startSelection!.map(local), selections)
}

// Eagerly apply all the mappings in the given branch, so that they
// don't endlessly accumulate in memory.
function compressBranch(branch: Branch) {
  let compressed = [], mapping = new EventMapping(ChangeSet.empty, 0, 0), selections = none
  for (let i = branch.length - 1; i >= 0; i--) {
    let event = mapEvent(branch[i], mapping, selections)
    mapping = event.mapped!
    if (event.changes.length || event.effects.length) {
      selections = none
      compressed.push(new HistEvent(event.changes, event.effects, null, event.startSelection, event.selectionsAfter))
    } else {
      selections = event.selectionsAfter
    }
  }
  if (selections) compressed.push(new HistEvent(none, none, null, null, selections))
  return compressed.reverse()
}

class HistoryState {
  constructor(public readonly done: Branch,
              public readonly undone: Branch,
              private readonly prevTime: number = 0,
              private readonly prevUserEvent: string | undefined = undefined) {}

  isolate() {
    return this.prevTime ? new HistoryState(this.done, this.undone) : this
  }

  addChanges(event: HistEvent, time: number, userEvent: string | undefined, newGroupDelay: number, maxLen: number): HistoryState {
    let done = this.done, lastEvent = done[done.length - 1]
    if (lastEvent && lastEvent.isChange &&
        time - this.prevTime < newGroupDelay &&
        !lastEvent.selectionsAfter.length &&
        lastEvent.changes.length && event.changes.length &&
        isAdjacent(lastEvent.changes[0], event.changes[event.changes.length - 1])) {
      done = updateBranch(done, done.length - 1, maxLen,
                          new HistEvent(conc(event.changes, lastEvent.changes), conc(event.effects, lastEvent.effects),
                                        lastEvent.mapped, lastEvent.startSelection, none))
    } else {
      done = updateBranch(done, done.length, maxLen, event)
    }
    return new HistoryState(done, none, time, userEvent)
  }

  addSelection(selection: EditorSelection, time: number, userEvent: string | undefined, newGroupDelay: number) {
    let last = this.done.length ? this.done[this.done.length - 1].selectionsAfter : none
    if (last.length > 0 &&
        time - this.prevTime < newGroupDelay &&
        userEvent == "keyboard" && this.prevUserEvent == "keyboard" &&
        eqSelectionShape(last[last.length - 1], selection))
      return this
    return new HistoryState(addSelection(this.done, selection), this.undone, time, userEvent)
  }

  addMapping(mapping: ChangeSet<ChangeDesc>): HistoryState {
    return new HistoryState(addMappingToBranch(this.done, new EventMapping(mapping, 0, 0)),
                            addMappingToBranch(this.undone, new EventMapping(mapping, 0, 0)),
                            this.prevTime, this.prevUserEvent)
  }

  pop(side: BranchName, state: EditorState, selection: boolean): Transaction | null {
    let branch = side == BranchName.Done ? this.done : this.undone
    if (branch.length == 0) return null
    let event = branch[branch.length - 1]
    if (selection && event.selectionsAfter.length) {
      let tr = state.t()
      tr.setSelection(event.selectionsAfter[event.selectionsAfter.length - 1])
      return tr.annotate(fromHistory, {side, rest: popSelection(branch)})
    } else {
      if (!event.isChange) return null
      let tr = state.t()
      for (let change of event.changes) tr.changeNoFilter(change)
      for (let effect of event.effects) tr.effect(effect)
      tr.setSelection(event.startSelection!)
      let rest = branch.length == 1 ? none : branch.slice(0, branch.length - 1)
      if (event.mapped)
        rest = addMappingToBranch(rest, event.mapped!)
      return tr.annotate(fromHistory, {side, rest})
    }
  }

  static empty: HistoryState = new HistoryState(none, none)
}
