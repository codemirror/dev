import {ChangeDesc, EditorState, Transaction, StateField, MetaSlot, Plugin} from "../../state/src"
import {HistoryState, PopTarget} from "./core"

const historyStateSlot = new MetaSlot<HistoryState>("historyState")
export const closeHistorySlot = new MetaSlot<boolean>("historyClose")

function isAdjacent(prev: ChangeDesc | null, cur: ChangeDesc): boolean {
  return !!prev && cur.from <= prev.mapPos(prev.to, 1) && cur.to >= prev.mapPos(prev.from)
}

const historyField = new StateField({
  init(editorState: EditorState): HistoryState {
    return HistoryState.empty
  },

  apply(tr: Transaction, state: HistoryState, editorState: EditorState): HistoryState {
    const fromMeta = tr.getMeta(historyStateSlot)
    if (fromMeta) return fromMeta
    const {newGroupDelay, minDepth} = editorState.getPluginWithField(historyField).config
    if (tr.getMeta(closeHistorySlot)) state = state.resetTime()
    if (tr.getMeta(MetaSlot.addToHistory) !== false)
      return state.addChanges(tr.changes, tr.invertedChanges(), tr.startState.selection,
                              isAdjacent, tr.getMeta(MetaSlot.time)!, newGroupDelay, minDepth)
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

function historyCmd(target: PopTarget, state: EditorState, dispatch?: (tr: Transaction) => void | null): boolean {
  const historyState: HistoryState | undefined = state.getField(historyField)
  if (!historyState || !historyState.canPop(target)) return false
  if (dispatch) {
    const {minDepth} = state.getPluginWithField(historyField).config
    const {transaction, state: newState} = historyState.pop(target, state.transaction, minDepth)
    dispatch(transaction.setMeta(historyStateSlot, newState))
  }
  return true
}

export function undo(state: EditorState, dispatch?: (tr: Transaction) => void | null): boolean {
  return historyCmd(PopTarget.Done, state, dispatch)
}

export function redo(state: EditorState, dispatch?: (tr: Transaction) => void | null): boolean {
  return historyCmd(PopTarget.Undone, state, dispatch)
}

// Set a flag on the given transaction that will prevent further steps
// from being appended to an existing history event (so that they
// require a separate undo command to undo).
export function closeHistory(tr: Transaction): Transaction {
  return tr.setMeta(closeHistorySlot, true)
}

// The amount of undoable events available in a given state.
export function undoDepth(state: EditorState): number {
  let hist = state.getField(historyField)
  return hist ? hist.eventCount(PopTarget.Done) : 0
}

// The amount of redoable events available in a given state.
export function redoDepth(state: EditorState): number {
  let hist = state.getField(historyField)
  return hist ? hist.eventCount(PopTarget.Undone) : 0
}
