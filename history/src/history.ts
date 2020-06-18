import {combineConfig, EditorState, Transaction, StateField, StateCommand, StateEffect,
        Facet, Annotation, Extension, ChangeSet, ChangeDesc, EditorSelection} from "@codemirror/next/state"
import {KeyBinding} from "@codemirror/next/view"

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

interface HistoryConfig {
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

  update(state: HistoryState, tr: Transaction): HistoryState {
    let config = tr.state.facet(historyConfig)

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
    else if (tr.selection)
      state = state.addSelection(tr.startState.selection, time, userEvent, config.newGroupDelay)

    if (isolate == "full" || isolate == "after") state = state.isolate()
    return state
  }
})

/// Create a history extension with the given configuration.
export function history(config: HistoryConfig = {}): Extension {
  // FIXME register beforeinput handler
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
    return branch.length - (branch.length && !branch[0].changes ? 1 : 0)
  }
}

/// The amount of undoable change events available in a given state.
export const undoDepth = depth(BranchName.Done)
/// The amount of redoable change events available in a given state.
export const redoDepth = depth(BranchName.Undone)

// History events store groups of changes or effects that need to be
// undone/redone together.
class HistEvent {
  constructor(
    // The changes in this event. Normal events hold at least one
    // change or effect. But it may be necessary to store selection
    // events before the first change, in which case a special type of
    // instance is created which doesn't hold any changes, with
    // changes == startSelection == undefined
    readonly changes: ChangeSet | undefined,
    // The effects associated with this event
    readonly effects: readonly StateEffect<any>[],
    readonly mapped: ChangeDesc | undefined,
    // The selection before this event
    readonly startSelection: EditorSelection | undefined,
    // Stores selection changes after this event, to be used for
    // selection undo/redo.
    readonly selectionsAfter: readonly EditorSelection[]
  ) {}

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
    if (!effects.length && tr.changes.empty) return null
    return new HistEvent(tr.changes.invert(tr.startState.doc), effects, undefined, tr.startState.selection, none)
  }

  static selection(selections: readonly EditorSelection[]) {
    return new HistEvent(undefined, none, undefined, undefined, selections)
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
  let ranges: number[] = [], isAdjacent = false
  a.iterChangedRanges((f, t) => ranges.push(f, t))
  b.iterChangedRanges((_f, _t, f, t) => {
    for (let i = 0; i < ranges.length;) {
      let from = ranges[i++], to = ranges[i++]
      if (t >= from && f <= to) isAdjacent = true
    }
  })
  return isAdjacent
}

function eqSelectionShape(a: EditorSelection, b: EditorSelection) {
  return a.ranges.length == b.ranges.length &&
         a.ranges.filter((r, i) => r.empty != b.ranges[i].empty).length === 0
}

function conc<T>(a: readonly T[], b: readonly T[]) {
  return !a.length ? b : !b.length ? a : a.concat(b)
}

const none: readonly any[] = []

const MaxSelectionsPerEvent = 200

function addSelection(branch: Branch, selection: EditorSelection) {
  if (!branch.length) {
    return [HistEvent.selection([selection])]
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
function addMappingToBranch(branch: Branch, mapping: ChangeDesc) {
  if (!branch.length) return branch
  let length = branch.length, selections = none
  while (length) {
    let event = mapEvent(branch[length - 1], mapping, selections)
    if (event.changes && !event.changes.empty || event.effects.length) { // Event survived mapping
      let result = branch.slice(0, length)
      result[length - 1] = event
      return result
    } else { // Drop this event, since there's no changes or effects left
      mapping = event.mapped!
      length--
      selections = event.selectionsAfter
    }
  }
  return selections.length ? [HistEvent.selection(selections)] : none
}

function mapEvent(event: HistEvent, mapping: ChangeDesc,
                  extraSelections: readonly EditorSelection[]) {
  let selections = conc(event.selectionsAfter.length ? event.selectionsAfter.map(s => s.map(mapping)) : none,
                        extraSelections)
  // Change-less events don't store mappings (they are always the last event in a branch)
  if (!event.changes) return HistEvent.selection(selections)

  let mappedChanges = event.changes.map(mapping), before = mapping.mapDesc(event.changes, true)
  let fullMapping = event.mapped ? event.mapped.composeDesc(before) : before
  return new HistEvent(mappedChanges, StateEffect.mapEffects(event.effects, mapping),
                       fullMapping, event.startSelection!.map(mapping), selections)
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
    if (lastEvent && lastEvent.changes &&
        time - this.prevTime < newGroupDelay &&
        !lastEvent.selectionsAfter.length &&
        lastEvent.changes.length && event.changes &&
        isAdjacent(lastEvent.changes, event.changes)) {
      done = updateBranch(done, done.length - 1, maxLen,
                          new HistEvent(event.changes.compose(lastEvent.changes), conc(event.effects, lastEvent.effects),
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
        userEvent == "keyboardselection" && this.prevUserEvent == userEvent &&
        eqSelectionShape(last[last.length - 1], selection))
      return this
    return new HistoryState(addSelection(this.done, selection), this.undone, time, userEvent)
  }

  addMapping(mapping: ChangeDesc): HistoryState {
    return new HistoryState(addMappingToBranch(this.done, mapping),
                            addMappingToBranch(this.undone, mapping),
                            this.prevTime, this.prevUserEvent)
  }

  pop(side: BranchName, state: EditorState, selection: boolean): Transaction | null {
    let branch = side == BranchName.Done ? this.done : this.undone
    if (branch.length == 0) return null
    let event = branch[branch.length - 1]
    if (selection && event.selectionsAfter.length) {
      return state.update({
        selection: event.selectionsAfter[event.selectionsAfter.length - 1],
        annotations: fromHistory.of({side, rest: popSelection(branch)})
      })
    } else if (!event.changes) {
      return null
    } else {
      let rest = branch.length == 1 ? none : branch.slice(0, branch.length - 1)
      if (event.mapped) rest = addMappingToBranch(rest, event.mapped!)
      return state.update({
        changes: event.changes,
        selection: event.startSelection,
        effects: event.effects,
        annotations: fromHistory.of({side, rest}),
        filter: false
      })
    }
  }

  static empty: HistoryState = new HistoryState(none, none)
}

/// Default key bindings for the undo history.
///
/// - Mod-z: [`undo`](#history.undo).
/// - Mod-y (Mod-Shift-z on macOS): [`redo`](#history.redo).
/// - Mod-u: [`undoSelection`](#history.undoSelection).
/// - Alt-u (Mod-Shift-u on macOS): [`redoSelection`](#history.redoSelection).
export const historyKeymap: readonly KeyBinding[] = [
  {key: "Mod-z", run: undo, preventDefault: true},
  {key: "Mod-y", mac: "Mod-Shift-z", run: redo, preventDefault: true},
  {key: "Mod-u", run: undoSelection, preventDefault: true},
  {key: "Alt-u", mac: "Mod-Shift-u", run: redoSelection, preventDefault: true}
]
