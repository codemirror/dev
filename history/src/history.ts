import {EditorState, Transaction, StateField, MetaSlot, StateBehavior} from "../../state/src"
import {combineConfig} from "../../behavior/src/behavior"
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
  constructor(public field: StateField<HistoryState>, public config: HistoryConfig) {}

  cmd(target: PopTarget, only: ItemFilter, state: EditorState, dispatch: (tr: Transaction) => void): boolean {
    let historyState = state.getField(this.field)
    if (!historyState.canPop(target, only)) return false
    const {transaction, state: newState} = historyState.pop(target, only, state.transaction, this.config.minDepth!)
    dispatch(transaction.setMeta(historyStateSlot, newState))
    return true
  }

  depth(target: PopTarget, only: ItemFilter, state: EditorState): number {
    return state.getField(this.field).eventCount(target, only)
  }
}

const historyBehavior = StateBehavior.define<HistoryBehavior>({unique: true})

export const history = StateBehavior.defineUniqueExtension<HistoryConfig>(configs => {
  let config = combineConfig(configs, {minDepth: Math.max}, {
    minDepth: 100,
    newGroupDelay: 500
  })
  let field = historyField(config.minDepth!, config.newGroupDelay!)
  return [
    StateBehavior.stateField(field),
    historyBehavior(new HistoryBehavior(field, config))
  ]
}, {})

function cmd(target: PopTarget, only: ItemFilter) {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let hist = state.behaviorSingle(historyBehavior, undefined)
    return hist ? hist.cmd(target, only, state, dispatch) : false
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
    let hist = state.behaviorSingle(historyBehavior, undefined)
    return hist ? hist.depth(target, only, state) : 0
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
