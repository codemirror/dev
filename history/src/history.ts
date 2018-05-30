import {Text} from "../../doc/src/text"
import {Change, EditorState, Transaction, StateField, MetaSlot, Plugin} from "../../state/src/state"
import {Mappable, Mapping, StepMap} from "prosemirror-transform"

// Used to schedule history compression
const max_empty_items = 500

const historyStateSlot = new MetaSlot<HistoryState>("historyState")
export const closeHistorySlot = new MetaSlot<boolean>("historyClose")

function getStepMap(change: Change) {
  return new StepMap([change.from, change.to - change.from, change.text.length])
}

function mapChange(map: Mappable, change: Change): Change {
  const from = map.map(change.from, 1)
  return new Change(from, Math.max(from, map.map(change.to, -1)), change.text)
}

class ChangesEntry {
  constructor(readonly changes: ReadonlyArray<Change>,
              readonly inverted: ReadonlyArray<Change>) {}
}

class MappingEntry {
  constructor(readonly map: Mapping) {};

  static fromChanges(changes: ReadonlyArray<Change>): MappingEntry {
    return new MappingEntry(new Mapping(changes.map(getStepMap)))
  }
}

type HistoryEntry = ChangesEntry | MappingEntry

const enum PopTarget {
  Done,
  Undone
}

class Branch {
  private constructor(public readonly entries: ReadonlyArray<HistoryEntry>,
                      public readonly eventCount: number) {}

  addChanges(changes: ReadonlyArray<Change>, docs: ReadonlyArray<Text>, tryMerge: boolean): Branch {
    const inverted = changes.map((c, i) => c.invert(docs[i]))
    const lastItem = this.entries[this.entries.length - 1]
    if (lastItem instanceof ChangesEntry &&
        tryMerge &&
        isAdjacent(lastItem.changes[lastItem.changes.length - 1], changes[0])) {
      const newEntries = this.entries.slice()
      newEntries[newEntries.length - 1] = new ChangesEntry(lastItem.changes.concat(changes), lastItem.inverted.concat(inverted))
      return new Branch(newEntries, this.eventCount)
    } else {
      return this.pushEntry(new ChangesEntry(changes, inverted))
    }
  }

  pushEntry(entry: HistoryEntry): Branch {
    return new Branch(this.entries.concat(entry),
                      this.eventCount + (entry instanceof ChangesEntry ? 1 : 0))
  }

  popChanges(): {changesEntry: ChangesEntry, newBranch: Branch, map: Mapping} | null {
    let idx
    for (idx = this.entries.length - 1; this.entries[idx] instanceof MappingEntry; --idx) {}
    if (!this.entries[idx]) return null

    const map = new Mapping()
    for (let i = idx + 1; i < this.entries.length; ++i) {
      const entry = this.entries[i] as MappingEntry
      map.appendMapping(entry.map)
    }

    let init: ReadonlyArray<HistoryEntry> = this.entries.slice(0, idx)
    // if there are no changes before map entries, we don't keep the map entries either
    if (init.length) {
      init = init.concat(new MappingEntry(map))
    }
    return {changesEntry: this.entries[idx] as ChangesEntry, newBranch: new Branch(init, this.eventCount - 1), map}
  }

  rebase(changes: ReadonlyArray<Change>, docs: ReadonlyArray<Text>, mapping: Mapping, rebasedCount: number): Branch {
    if (!this.eventCount) return this

    const rebasedItems = [], start = Math.max(0, this.entries.length - rebasedCount)
    let newUntil = changes.length
    let eventCount = this.eventCount

    let iRebased = rebasedCount
    for (let i = start; i < this.entries.length; ++i) {
      const entry = this.entries[i]
      const pos = mapping.getMirror(--iRebased)
      if (pos == null) {
        if (entry instanceof ChangesEntry) --eventCount
        continue
      }
      newUntil = Math.min(newUntil, pos)
      if (entry instanceof ChangesEntry) {
        rebasedItems.push(new ChangesEntry([changes[pos]], [changes[pos].invert(docs[pos])]))
      } else {
        rebasedItems.push(entry)
      }
    }

    const newMap = new Mapping
    for (let i = rebasedCount; i < newUntil; i++) newMap.appendMap(mapping.maps[i])
    const entries = this.entries.slice(0, start).concat([new MappingEntry(newMap)]).concat(rebasedItems)
    let branch = new Branch(entries, eventCount)
    if (entries.length - eventCount > max_empty_items)
      branch = branch.compress(this.entries.length - rebasedItems.length)
    return branch
  }

  // FIXME: This only compresses consecutive `MappingEntry`s instead of mapping
  // `ChangeEntry`s and discarding `MappingEntry`s.
  compress(upto: number = this.entries.length): Branch {
    const newEntries = []
    let eventCount = 0
    let map = null
    for (let i = 0; i < upto; ++i) {
      const entry = this.entries[i]
      if (entry instanceof MappingEntry) {
        if (!map) map = new Mapping()
        map.appendMapping(entry.map)
      } else {
        if (map) {
          newEntries.push(new MappingEntry(map))
          map = null
        }
        newEntries.push(entry)
        ++eventCount
      }
    }
    if (map) {
      newEntries.push(new MappingEntry(map))
      map = null
    }
    return new Branch(newEntries.concat(this.entries.slice(upto)), eventCount)
  }

  static readonly empty: Branch = new Branch([], 0)
}

class HistoryState {
  constructor(public readonly done: Branch,
              public readonly undone: Branch,
              private readonly prevTime: number | null = null) {}

  addChanges(changes: ReadonlyArray<Change>, docs: ReadonlyArray<Text>, time: number, newGroupDelay: number): HistoryState {
    if (changes.length == 0) return this
    return new HistoryState(this.done.addChanges(changes, docs, this.prevTime !== null && time - this.prevTime < newGroupDelay),
                            this.undone, time)
  }

  rebase(changes: ReadonlyArray<Change>, docs: ReadonlyArray<Text>, mapping: Mapping, rebasedCount: number): HistoryState {
    return new HistoryState(this.done.rebase(changes, docs, mapping, rebasedCount),
                            this.undone.rebase(changes, docs, mapping, rebasedCount),
                            this.prevTime)
  }

  addMapping(entry: MappingEntry): HistoryState {
    if (this.done.entries.length == 0) return this
    return new HistoryState(this.done.pushEntry(entry), this.undone)
  }

  canPop(done: PopTarget): boolean {
    return (done == PopTarget.Done ? this.done : this.undone).entries.length > 0
  }

  pop(done: PopTarget): {changes: ReadonlyArray<Change>, state: HistoryState, map: Mapping} {
    const popResult = (done == PopTarget.Done ? this.done : this.undone).popChanges()
    if (!popResult) {
      if (this.canPop(done)) throw new Error("LogicError: canPop returns true but pop fails")
      throw new Error("Shouldn't call pop if canPop returns false")
    }
    const {newBranch, changesEntry, map} = popResult
    let changes = [], inverted = []
    for (let i = 0; i < changesEntry.changes.length; ++i) {
      const change = changesEntry.changes[i]
      if (!map.mapResult(change.from, 1).deleted && !map.mapResult(change.from + change.text.length, -1).deleted) {
        changes.unshift(mapChange(map, change))
        inverted.unshift(mapChange(map, changesEntry.inverted[i]))
      }
    }
    let otherSide = (done == PopTarget.Done ? this.undone : this.done)
    if (changes.length > 0) {
      otherSide = otherSide.pushEntry(new ChangesEntry(inverted, changes))
    }
    return {
      changes: changesEntry.inverted,
      state: new HistoryState(done == PopTarget.Done ? newBranch : otherSide,
                              done == PopTarget.Done ? otherSide : newBranch),
      map
    }
  }
}

function isAdjacent(prev: Change | null, cur: Change): boolean {
  if (!prev) return true
  return cur.from <= prev.mapPos(prev.to) && cur.to >= prev.mapPos(prev.from, -1)
}

const historyField = new StateField({
  init() {
    return new HistoryState(Branch.empty, Branch.empty)
  },

  apply(tr: Transaction, state: HistoryState, editorState: EditorState): HistoryState {
    const fromMeta = tr.getMeta(historyStateSlot)
    const {config} = editorState.getPluginWithField(historyField)!
    if (fromMeta) return fromMeta
    if (tr.getMeta(closeHistorySlot)) state = new HistoryState(state.done, state.undone, null)
    let rebased
    if (rebased = tr.getMeta(MetaSlot.rebased)) {
      return state.rebase(tr.changes, [tr.startState.doc].concat(tr.docs), tr.mapping, rebased)
    } else if (tr.getMeta(MetaSlot.addToHistory) !== false) {
      return state.addChanges(tr.changes, [tr.startState.doc].concat(tr.docs), tr.getMeta(MetaSlot.time)!, config.newGroupDelay)
    } else {
      return state.addMapping(MappingEntry.fromChanges(tr.changes))
    }
  },

  debugName: "historyState"
})

export function history({newGroupDelay = 500}: {newGroupDelay?: number} = {}): Plugin {
  return new Plugin({
    state: historyField,
    config: {newGroupDelay}
  })
}

function historyCmd(target: PopTarget, state: EditorState, dispatch?: (tr: Transaction) => void | null): boolean {
  const historyState: HistoryState | undefined = state.getField(historyField)
  if (!historyState || !historyState.canPop(target)) return false
  if (dispatch) {
    const {changes, state: newState, map} = historyState.pop(target)
    let tr = state.transaction.setMeta(historyStateSlot, newState)
    let revChanges = changes.slice().reverse()
    for (let change of revChanges) {
      change = mapChange(map, change)
      tr = tr.change(change)
    }
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
