import {Change, EditorState, Transaction, StateField, MetaSlot, Plugin} from "../../state/src/state"
import {Mapping, StepMap} from "prosemirror-transform"
import {HistoryState, Mapping as HistoryMapping, PopTarget} from "./core"

export const mappingSlot = new MetaSlot("mapping")

class MyMapping /*implements HistoryMapping<Change, MyMapping>*/ {
  private constructor(private readonly m: Mapping) {}

  concat(otherM: MyMapping): MyMapping {
    const newM = this.m.slice()
    newM.appendMapping(otherM.m)
    return new MyMapping(newM)
  }
  mapChange(change: Change): Change {
    const from = this.m.map(change.from, 1)
    return new Change(from, Math.max(from, this.m.map(change.to, -1)), change.text)
  }
  deletesChange(change: Change): boolean {
    return this.m.mapResult(change.from, 1).deleted || this.m.mapResult(change.from + change.text.length, -1).deleted
  }
  static fromChanges(changes: ReadonlyArray<Change>): MyMapping {
    return new MyMapping(new Mapping(changes.map(
      change => new StepMap([change.from, change.to - change.from, change.text.length])
    )))
  }
}

const historyStateSlot = new MetaSlot<HistoryState<Change, MyMapping>>("historyState")
export const closeHistorySlot = new MetaSlot<boolean>("historyClose")

class ChangeList {
  readonly length: number
  constructor(readonly changes: ReadonlyArray<Change>,
              readonly inverted: ReadonlyArray<Change>,
              private readonly mirror: ReadonlyArray<number> = []) {
    this.length = changes.length
  }

  get(n: number): Change {
    return this.changes[n]
  }

  getInverted(n: number): Change {
    return this.inverted[n]
  }

  getMirror(n: number): number | null {
    for (let i = 0; i < this.mirror.length; i++)
      if (this.mirror[i] == n) return this.mirror[i + (i % 2 ? -1 : 1)]
    return null
  }

  getMapping(from: number, to: number): MyMapping {
    return MyMapping.fromChanges(this.changes.slice(from, to))
  }
}

function isAdjacent(prev: Change | null, cur: Change): boolean {
  if (!prev) return true
  return cur.from <= prev.mapPos(prev.to) && cur.to >= prev.mapPos(prev.from, -1)
}

const historyField = new StateField({
  init(editorState: EditorState): HistoryState<Change, MyMapping> {
    const {minDepth} = editorState.getPluginWithField(historyField).config
    return HistoryState.empty(minDepth)
  },

  apply(tr: Transaction, state: HistoryState<Change, MyMapping>, editorState: EditorState): HistoryState<Change, MyMapping> {
    const fromMeta = tr.getMeta(historyStateSlot)
    if (fromMeta) return fromMeta
    const {newGroupDelay} = editorState.getPluginWithField(historyField).config
    if (tr.getMeta(closeHistorySlot)) state = state.resetTime()
    let rebased
    if (rebased = tr.getMeta(MetaSlot.rebased)) {
      const docs = [tr.startState.doc].concat(tr.docs)
      const inverted = tr.changes.map((c, i) => c.invert(docs[i]))
      return state.rebase(new ChangeList(tr.changes, inverted, tr.getMeta(mappingSlot).mirror), rebased)
    } else if (tr.getMeta(MetaSlot.addToHistory) !== false) {
      const docs = [tr.startState.doc].concat(tr.docs)
      const inverted = tr.changes.map((c, i) => c.invert(docs[i]))
      return state.addChanges(new ChangeList(tr.changes, inverted), isAdjacent, tr.getMeta(MetaSlot.time), newGroupDelay)
    } else {
      return state.addMapping(MyMapping.fromChanges(tr.changes))
    }
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
  const historyState: HistoryState<Change, MyMapping> | undefined = state.getField(historyField)
  if (!historyState || !historyState.canPop(target)) return false
  if (dispatch) {
    const {changes, state: newState} = historyState.pop(target)
    let tr = state.transaction.setMeta(historyStateSlot, newState)
    for (const change of changes) tr = tr.change(change)
    dispatch(tr)
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
  return hist ? hist.done.eventCount : 0
}

// The amount of redoable events available in a given state.
export function redoDepth(state: EditorState): number {
  let hist = state.getField(historyField)
  return hist ? hist.undone.eventCount : 0
}
