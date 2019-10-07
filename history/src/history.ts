import {EditorState, Transaction, StateField, Command} from "../../state"
import {combineConfig, Slot} from "../../extension"
import {HistoryState, ItemFilter, PopTarget} from "./core"

const historyStateSlot = Slot.define<HistoryState>()

const closeHistorySlot = Slot.define<boolean>()

/// Options given when creating a history extension.
export interface HistoryConfig {
  /// The minimum depth (amount of events) to store. Defaults to 100.
  minDepth?: number,
  /// The maximum time (in milliseconds) that adjacent events can be
  /// apart and still be grouped together. Defaults to 500.
  newGroupDelay?: number
}

const historyField = new StateField({
  init(editorState: EditorState): HistoryState {
    return HistoryState.empty
  },

  apply(tr: Transaction, state: HistoryState, editorState: EditorState): HistoryState {
    const fromMeta = tr.getMeta(historyStateSlot)
    if (fromMeta) return fromMeta
    if (tr.getMeta(closeHistorySlot)) state = state.resetTime()
    if (!tr.changes.length && !tr.selectionSet) return state

    let config = editorState.behavior(historyConfig)[0]
    if (tr.getMeta(Transaction.addToHistory) !== false)
      return state.addChanges(tr.changes, tr.changes.length ? tr.invertedChanges() : null,
                              tr.startState.selection, tr.getMeta(Transaction.time)!,
                              tr.getMeta(Transaction.userEvent), config.newGroupDelay, config.minDepth)
    return state.addMapping(tr.changes.desc, config.minDepth)
  }
})

const historyConfig = EditorState.extend.behavior<Required<HistoryConfig>>()

/// Create a history extension with the given configuration.
export const history = EditorState.extend.unique<HistoryConfig>(configs => {
  let config = combineConfig(configs, {
    minDepth: 100,
    newGroupDelay: 500
  }, {minDepth: Math.max, newGroupDelay: Math.min})
  return [
    historyField.extension,
    historyConfig(config)
  ]
}, {})

function cmd(target: PopTarget, only: ItemFilter): Command {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let behavior = state.behavior(historyConfig)
    if (!behavior.length) return false
    let config = behavior[0]
    let historyState = state.field(historyField)
    if (!historyState.canPop(target, only)) return false
    const {transaction, state: newState} = historyState.pop(target, only, state.t(), config.minDepth)
    dispatch(transaction.addMeta(historyStateSlot(newState)))
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
  return tr.addMeta(closeHistorySlot(true))
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
