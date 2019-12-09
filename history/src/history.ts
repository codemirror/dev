import {EditorState, Transaction, StateField, StateCommand, Annotation, Facet, Extension} from "../../state"
import {combineConfig} from "../../extension"
import {HistoryState, ItemFilter, PopTarget} from "./core"

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
  dependencies: [historyConfig],

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
    dispatch(transaction.annotate(historyStateAnnotation(newState)))
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
  return tr.annotate(closeHistoryAnnotation(true))
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
