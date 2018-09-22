import {EditorState, Transaction, StateField, MetaSlot, Plugin} from "../../state/src"
import {HistoryState, ItemFilter, PopTarget} from "./core"

const historyStateSlot = new MetaSlot<HistoryState>("historyState")
export const closeHistorySlot = new MetaSlot<boolean>("historyClose")

const historyField = new StateField({
  init(editorState: EditorState): HistoryState {
    return HistoryState.empty
  },

  apply(tr: Transaction, state: HistoryState, editorState: EditorState): HistoryState {
    const fromMeta = tr.getMeta(historyStateSlot)
    if (fromMeta) return fromMeta
    if (tr.getMeta(closeHistorySlot)) state = state.resetTime()
    if (!tr.changes.length && !tr.selectionSet) return state

    const {newGroupDelay, minDepth} = editorState.getPluginWithField(historyField).config
    if (tr.getMeta(MetaSlot.addToHistory) !== false)
      return state.addChanges(tr.changes, tr.changes.length ? tr.invertedChanges() : null, tr.startState.selection,
                              tr.getMeta(MetaSlot.time)!, newGroupDelay, minDepth)
    return state.addMapping(tr.changes.desc, minDepth)
  },

  debugName: "historyState"
})

export function history({minDepth = 100, newGroupDelay = 500}: {minDepth?: number, newGroupDelay?: number} = {}): Plugin {
  return new Plugin({
    state: historyField,
    config: {minDepth, newGroupDelay}
  })
}

function historyCmd(target: PopTarget, only: ItemFilter, state: EditorState, dispatch: (tr: Transaction) => void): boolean {
  const historyState: HistoryState | undefined = state.getField(historyField)
  if (!historyState || !historyState.canPop(target, only)) return false
  const {minDepth} = state.getPluginWithField(historyField).config
  const {transaction, state: newState} = historyState.pop(target, only, state.transaction, minDepth)
  dispatch(transaction.setMeta(historyStateSlot, newState))
  return true
}

export function undo({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}): boolean {
  return historyCmd(PopTarget.Done, ItemFilter.OnlyChanges, state, dispatch)
}

export function redo({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}): boolean {
  return historyCmd(PopTarget.Undone, ItemFilter.OnlyChanges, state, dispatch)
}

export function undoSelection({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}): boolean {
  return historyCmd(PopTarget.Done, ItemFilter.Any, state, dispatch)
}

export function redoSelection({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}): boolean {
  return historyCmd(PopTarget.Undone, ItemFilter.Any, state, dispatch)
}

// Set a flag on the given transaction that will prevent further steps
// from being appended to an existing history event (so that they
// require a separate undo command to undo).
export function closeHistory(tr: Transaction): Transaction {
  return tr.setMeta(closeHistorySlot, true)
}

// The amount of undoable change events available in a given state.
export function undoDepth(state: EditorState): number {
  let hist = state.getField(historyField)
  return hist ? hist.eventCount(PopTarget.Done, ItemFilter.OnlyChanges) : 0
}

// The amount of redoable change events available in a given state.
export function redoDepth(state: EditorState): number {
  let hist = state.getField(historyField)
  return hist ? hist.eventCount(PopTarget.Undone, ItemFilter.OnlyChanges) : 0
}

// The amount of undoable events available in a given state.
export function undoSelectionDepth(state: EditorState): number {
  let hist = state.getField(historyField)
  return hist ? hist.eventCount(PopTarget.Done, ItemFilter.Any) : 0
}

// The amount of redoable events available in a given state.
export function redoSelectionDepth(state: EditorState): number {
  let hist = state.getField(historyField)
  return hist ? hist.eventCount(PopTarget.Undone, ItemFilter.Any) : 0
}
