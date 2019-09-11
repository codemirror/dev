import {EditorState, Transaction, StateField} from "../../state/src"
import {Extension, combineConfig, Slot} from "../../extension/src/extension"
import {HistoryState, ItemFilter, PopTarget} from "./core"

const historyStateSlot = Slot.define<HistoryState>()
export const closeHistorySlot = Slot.define<boolean>()

export interface HistoryConfig {minDepth?: number, newGroupDelay?: number}

const historyField = new StateField({
  init(editorState: EditorState): HistoryState {
    return HistoryState.empty
  },

  apply(tr: Transaction, state: HistoryState, editorState: EditorState): HistoryState {
    const fromMeta = tr.getMeta(historyStateSlot)
    if (fromMeta) return fromMeta
    if (tr.getMeta(closeHistorySlot)) state = state.resetTime()
    if (!tr.changes.length && !tr.selectionSet) return state

    let config = editorState.behavior.get(historyConfig)[0]
    if (tr.getMeta(Transaction.addToHistory) !== false)
      return state.addChanges(tr.changes, tr.changes.length ? tr.invertedChanges() : null,
                              tr.startState.selection, tr.getMeta(Transaction.time)!,
                              tr.getMeta(Transaction.userEvent), config.newGroupDelay, config.minDepth)
    return state.addMapping(tr.changes.desc, config.minDepth)
  }
})

const historyConfig = EditorState.extend.behavior<Required<HistoryConfig>>()

export const history = EditorState.extend.unique<HistoryConfig>(configs => {
  let config = combineConfig(configs, {
    minDepth: 100,
    newGroupDelay: 500
  }, {minDepth: Math.max})
  return Extension.all(
    historyField.extension,
    historyConfig(config)
  )
}, {})

function cmd(target: PopTarget, only: ItemFilter) {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let behavior = state.behavior.get(historyConfig)
    if (!behavior.length) return false
    let config = behavior[0]
    let historyState = state.getField(historyField)
    if (!historyState.canPop(target, only)) return false
    const {transaction, state: newState} = historyState.pop(target, only, state.t(), config.minDepth)
    dispatch(transaction.addMeta(historyStateSlot(newState)))
    return true
  }
}

export const undo = cmd(PopTarget.Done, ItemFilter.OnlyChanges)
export const redo = cmd(PopTarget.Undone, ItemFilter.OnlyChanges)
export const undoSelection = cmd(PopTarget.Done, ItemFilter.Any)
export const redoSelection = cmd(PopTarget.Undone, ItemFilter.Any)

// Set a flag on the given transaction that will prevent further steps
// from being appended to an existing history event (so that they
// require a separate undo command to undo).
export function closeHistory(tr: Transaction): Transaction {
  return tr.addMeta(closeHistorySlot(true))
}

function depth(target: PopTarget, only: ItemFilter) {
  return function(state: EditorState): number {
    let histState = state.getField(historyField, false)
    return histState ? histState.eventCount(target, only) : 0
  }
}

// The amount of undoable change events available in a given state.
export const undoDepth = depth(PopTarget.Done, ItemFilter.OnlyChanges)
// The amount of redoable change events available in a given state.
export const redoDepth = depth(PopTarget.Undone, ItemFilter.OnlyChanges)
// The amount of undoable events available in a given state.
export const redoSelectionDepth = depth(PopTarget.Done, ItemFilter.Any)
// The amount of redoable events available in a given state.
export const undoSelectionDepth = depth(PopTarget.Undone, ItemFilter.Any)
