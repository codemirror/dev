import {EditorState, Transaction, StateField, MetaSlot, Behavior} from "../../state/src"
import {HistoryState, ItemFilter, PopTarget} from "./core"

const historyStateSlot = new MetaSlot<HistoryState>("historyState")
export const closeHistorySlot = new MetaSlot<boolean>("historyClose")

function historyField(minDepth: number, newGroupDelay: number) {
  return new StateField({
    init(editorState: EditorState): HistoryState {
      return HistoryState.empty
    },

    apply(tr: Transaction, state: HistoryState, editorState: EditorState): HistoryState {
      const fromMeta = tr.getMeta(historyStateSlot)
      if (fromMeta) return fromMeta
      if (tr.getMeta(closeHistorySlot)) state = state.resetTime()
      if (!tr.changes.length && !tr.selectionSet) return state

      if (tr.getMeta(MetaSlot.addToHistory) !== false)
        return state.addChanges(tr.changes, tr.changes.length ? tr.invertedChanges() : null,
                                tr.startState.selection, tr.getMeta(MetaSlot.time)!,
                                tr.getMeta(MetaSlot.userEvent), newGroupDelay, minDepth)
      return state.addMapping(tr.changes.desc, minDepth)
    },

    name: "historyState"
  })
}

export interface HistoryConfig {minDepth?: number, newGroupDelay?: number}

class HistoryBehavior {
  field: StateField<HistoryState>

  constructor(public minDepth: number, public newGroupDelay: number) {
    this.field = historyField(minDepth, newGroupDelay)
  }

  cmd(target: PopTarget, only: ItemFilter, state: EditorState, dispatch: (tr: Transaction) => void): boolean {
    let historyState = state.getField(this.field)
    if (!historyState.canPop(target, only)) return false
    const {transaction, state: newState} = historyState.pop(target, only, state.transaction, this.minDepth)
    dispatch(transaction.setMeta(historyStateSlot, newState))
    return true
  }

  depth(target: PopTarget, only: ItemFilter, state: EditorState): number {
    return state.getField(this.field).eventCount(target, only)
  }
}

export const history = Behavior.define<HistoryConfig, HistoryBehavior>({
  combine(configs) {
    return new HistoryBehavior(configs.reduce((d, c) => Math.max(d, c.minDepth || 0), 0) || 100,
                               configs.reduce((d, c) => Math.max(d, c.newGroupDelay || 0), 0) || 500)
  },
  behavior: historyBehavior => [Behavior.stateField.use(historyBehavior.field)],
  default: {}
})

function cmd(target: PopTarget, only: ItemFilter) {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let behavior = history.get(state)
    if (!behavior) return false
    return behavior.cmd(target, only, state, dispatch)
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
  return tr.setMeta(closeHistorySlot, true)
}

function depth(target: PopTarget, only: ItemFilter) {
  return function(state: EditorState): number {
    let behavior = history.get(state)
    return behavior ? behavior.depth(target, only, state) : 0
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
