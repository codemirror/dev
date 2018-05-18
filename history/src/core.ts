import {TruncatingStack} from "./stack"

// Used to schedule history compression
const max_empty_items = 500

export interface ChangeList<C, M extends Mapping<C, M>> {
  readonly length: number
  readonly changes: ReadonlyArray<C>
  readonly inverted: ReadonlyArray<C>
  get(n: number): C
  getInverted(n: number): C
  getMirror(n: number): number | null
  getMapping(from: number, to: number): M
}

export interface Mapping<C, Self> {
  concat(m: Self): Self
  mapChange(change: C): C
  deletesChange(change: C): boolean
}

class ChangesEntry<Change> {
  constructor(readonly changes: ReadonlyArray<Change>,
              readonly inverted: ReadonlyArray<Change>) {}
}

class MappingEntry<Change, M extends Mapping<Change, M>> {
  constructor(readonly map: M) {}
}

type HistoryEntry<Change, M extends Mapping<Change, M>> = ChangesEntry<Change> | MappingEntry<Change, M>

class Branch<Change, M extends Mapping<Change, M>> {
  static empty<Change, M extends Mapping<Change, M>>(maxLen: number): Branch<Change, M> {
    return new Branch(TruncatingStack.empty(maxLen))
  }
  private constructor(private readonly stack: TruncatingStack<HistoryEntry<Change, M>>) {}

  get eventCount(): number {
    let count = 0, len = this.stack.length
    for (let i = 0; i < len; ++i) {
      if (this.stack.get(i) instanceof ChangesEntry) ++count
    }
    return count
  }

  isEmpty(): boolean {
    return this.stack.lastItem == null
  }

  addChanges(changes: ChangeList<Change, M>, isAdjacent: (prevChange: Change | null, curChange: Change) => boolean, tryMerge: boolean): Branch<Change, M> {
    const lastItem = this.stack.lastItem
    if (lastItem instanceof ChangesEntry &&
        tryMerge &&
        isAdjacent(lastItem.changes[lastItem.changes.length - 1], changes.get(0))) {
      return new Branch(this.stack.replaceFrom(this.stack.length - 1, [new ChangesEntry(lastItem.changes.concat(changes.changes), lastItem.inverted.concat(changes.inverted))]))
    }
    return this.pushEntry(new ChangesEntry(changes.changes, changes.inverted))
  }

  pushEntry(entry: HistoryEntry<Change, M>): Branch<Change, M> {
    return new Branch(this.stack.push(entry))
  }

  popChanges(): {changesEntry: ChangesEntry<Change>, newBranch: Branch<Change, M>, map: M | null} | null {
    let idx
    for (idx = this.stack.length - 1; this.stack.get(idx) instanceof MappingEntry; --idx) {}
    const changesEntry = this.stack.get(idx) as ChangesEntry<Change>
    let map = null
    if (idx < this.stack.length - 1) {
      map = (this.stack.get(idx + 1) as MappingEntry<Change, M>).map
      for (let i = idx + 2; i < this.stack.length; ++i) {
        const entry = this.stack.get(i) as MappingEntry<Change, M>
        map = map.concat(entry.map)
      }
    }
    // if there are no changes before map entries, we don't keep the map entries either
    const replaceWith = map && idx > 0 ? [new MappingEntry(map)] : []
    const stack = this.stack.replaceFrom(idx, replaceWith)
    return {changesEntry, newBranch: new Branch(stack), map}
  }

  // Record the fact that `rebasedCount` local changes were rebased as represented in `changes`.
  // changes is expected to represent a chain of changes like this:
  //  -LocalChangeN, ..., -LocalChange1, RemoteChanges, LocalChange1, ..., LocalChangeN
  // rebasedCount equals N
  // The expected result looks like this:
  // SharedChanges, mapping for RemoteChanges, LocalChange1, ..., LocalChangeN
  rebase(changes: ChangeList<Change, M>, rebasedCount: number): Branch<Change, M> {
    if (this.isEmpty()) return this

    const itemCount = this.stack.length
    const rebasedItems = [], start = Math.max(0, itemCount - rebasedCount)
    let newUntil = changes.length
    let eventCount = this.eventCount

    for (let i = start, iRebased = rebasedCount; i < itemCount; ++i) {
      const entry = this.stack.get(i) as HistoryEntry<Change, M>
      const pos = changes.getMirror(--iRebased)
      if (pos == null) {
        // This entry is not shared nor was it rebased, so we drop it
        if (entry instanceof ChangesEntry) --eventCount
        continue
      }
      newUntil = Math.min(newUntil, pos)
      if (entry instanceof ChangesEntry) {
        rebasedItems.push(new ChangesEntry([changes.get(pos)], [changes.getInverted(pos)]))
      } else {
        rebasedItems.push(entry)
      }
    }

    const newMap = changes.getMapping(rebasedCount, newUntil)
    const stack = this.stack.replaceFrom(start, [new MappingEntry<Change, M>(newMap)].concat(rebasedItems))
    let branch = new Branch(stack)
    if (stack.length - eventCount > max_empty_items)
      branch = branch.compress(itemCount - rebasedItems.length)
    return branch
  }

  // FIXME: This only compresses consecutive `MappingEntry`s instead of mapping
  // `ChangeEntry`s and discarding `MappingEntry`s.
  compress(upto: number = this.stack.length): Branch<Change, M> {
    const newEntries: HistoryEntry<Change, M>[] = []
    let map = null
    for (let i = 0; i < upto; ++i) {
      const entry = this.stack.get(i) as HistoryEntry<Change, M>
      if (entry instanceof MappingEntry) {
        if (!map) map = entry.map
        else map = map.concat(entry.map)
      } else {
        if (map) {
          newEntries.push(new MappingEntry<Change, M>(map))
          map = null
        }
        newEntries.push(entry)
      }
    }
    if (map) {
      newEntries.push(new MappingEntry<Change, M>(map))
      map = null
    }
    return new Branch(this.stack.replaceBefore(upto, newEntries))
  }
}

export const enum PopTarget {
  Done,
  Undone
}

export class HistoryState<Change, M extends Mapping<Change, M>> {
  private constructor(public readonly done: Branch<Change, M>,
              public readonly undone: Branch<Change, M>,
              private readonly prevTime: number | null = null) {}

  resetTime(): HistoryState<Change, M> {
    return new HistoryState(this.done, this.undone)
  }

  addChanges(changes: ChangeList<Change, M>, isAdjacent: (prevChange: Change | null, curChange: Change) => boolean, time: number, newGroupDelay: number): HistoryState<Change, M> {
    if (changes.length == 0) return this
    return new HistoryState(this.done.addChanges(changes, isAdjacent, this.prevTime !== null && time - this.prevTime < newGroupDelay),
                            this.undone, time)
  }

  addMapping(map: M): HistoryState<Change, M> {
    if (this.done.isEmpty()) return this
    return new HistoryState(this.done.pushEntry(new MappingEntry(map)), this.undone)
  }

  rebase(changes: ChangeList<Change, M>, rebasedCount: number): HistoryState<Change, M> {
    return new HistoryState(this.done.rebase(changes, rebasedCount),
                            this.undone.rebase(changes, rebasedCount),
                            this.prevTime)
  }

  canPop(done: PopTarget): boolean {
    return !(done == PopTarget.Done ? this.done : this.undone).isEmpty()
  }

  pop(done: PopTarget): {changes: ReadonlyArray<Change>, state: HistoryState<Change, M>} {
    const popResult = (done == PopTarget.Done ? this.done : this.undone).popChanges()
    if (!popResult) {
      if (this.canPop(done)) throw new Error("LogicError: canPop returns true but pop fails")
      throw new Error("Shouldn't call pop if canPop returns false")
    }
    const {newBranch, changesEntry, map} = popResult
    let otherSideEntry, poppedChanges
    if (map) {
      let changes = [], inverted = []
      poppedChanges = []
      for (let i = 0; i < changesEntry.changes.length; ++i) {
        const change = changesEntry.changes[i]
        const mappedInvertedChange = map.mapChange(changesEntry.inverted[i])
        if (!map.deletesChange(change)) {
          changes.unshift(map.mapChange(change))
          inverted.unshift(mappedInvertedChange)
        }
        poppedChanges.unshift(mappedInvertedChange)
      }
      otherSideEntry = new ChangesEntry(inverted, changes)
    } else {
      poppedChanges = changesEntry.inverted.slice().reverse()
      otherSideEntry = new ChangesEntry(poppedChanges, changesEntry.changes.slice().reverse())
    }

    let otherSide = done == PopTarget.Done ? this.undone : this.done
    if (otherSideEntry.changes.length > 0) otherSide = otherSide.pushEntry(otherSideEntry)
    return {
      changes: poppedChanges,
      state: new HistoryState(done == PopTarget.Done ? newBranch : otherSide,
                              done == PopTarget.Done ? otherSide : newBranch)
    }
  }

  static empty<Change, M extends Mapping<Change, M>>(maxLen: number): HistoryState<Change, M> {
    return new HistoryState(Branch.empty(maxLen), Branch.empty(maxLen))
  }
}
