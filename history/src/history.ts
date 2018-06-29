import {Change, ChangeSet, EditorState, Transaction, StateField, MetaSlot, Plugin} from "../../state/src/state"
import {HistoryState, PopTarget} from "./core"

class MyMapping /*implements Mapping<Change, MyMapping>*/ {
  private constructor(private readonly changes: ReadonlyArray<Change>) {}

  concat(otherM: MyMapping): MyMapping {
    return new MyMapping(this.changes.concat(otherM.changes))
  }

  mapChange(change: Change): Change {
    const from = this._map(change.from, 1) as number
    return new Change(from, Math.max(from, this._map(change.to, -1) as number), change.text)
  }

  deletesChange(change: Change): boolean {
    return this._map(change.from, 1, true) as boolean ||
           this._map(change.from + change.text.length, -1, true) as boolean
  }

  _map(pos: number, assoc: -1 | 1, deleted: boolean = false): number | boolean {
    for (const change of this.changes) {
      const start = change.from
      if (start > pos) continue
      const oldSize = change.to - change.from, newSize = change.text.length, end = start + oldSize
      if (pos <= end) {
        const side = !oldSize ? assoc : pos == start ? -1 : pos == end ? 1 : assoc
        if (deleted && (assoc < 0 ? pos != start : pos != end)) return true
        pos = start + (side < 0 ? 0 : newSize)
      } else pos += newSize - oldSize
    }
    return deleted ? false : pos
  }

  static fromChanges(changes: ReadonlyArray<Change>): MyMapping {
    return new MyMapping(changes)
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
  // FIXME not great, maybe bring back Change.mapPos
  let mapping = new ChangeSet([prev])
  return cur.from <= mapping.mapPos(prev.to) && cur.to >= mapping.mapPos(prev.from, -1)
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
      // FIXME make this easy on top of Transaction
      const docs = [tr.startState.doc].concat(tr.docs)
      const inverted = tr.changes.changes.map((c, i) => c.invert(docs[i]))
      return state.rebase(new ChangeList(tr.changes.changes, inverted, tr.changes.mirror), rebased)
    } else if (tr.getMeta(MetaSlot.addToHistory) !== false) {
      const docs = [tr.startState.doc].concat(tr.docs)
      const inverted = tr.changes.changes.map((c, i) => c.invert(docs[i]))
      return state.addChanges(new ChangeList(tr.changes.changes, inverted), isAdjacent, tr.getMeta(MetaSlot.time)!, newGroupDelay)
    } else {
      return state.addMapping(MyMapping.fromChanges(tr.changes.changes))
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
