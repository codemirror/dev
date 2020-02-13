import {ChangeSet, Change, ChangedRange, MapMode} from "../../state"

/// Each range is associated with a value, which must inherit from
/// this class.
export abstract class RangeValue {
  /// Compare this value with another value. The default
  /// implementation compares by identity.
  eq(other: RangeValue) { return this == other }
  /// The bias value at the start of the range. Defaults to 0.
  startSide!: number
  /// The bias value at the end of the range. Defaults to 0.
  endSide!: number

  /// The mode with which the start point of the range should be
  /// mapped. Determines when a side is counted as deleted. Defaults
  /// to `MapMode.TrackDel`.
  startMapMode!: MapMode
  /// The mode with which the end point of the range should be mapped.
  endMapMode!: MapMode
  /// Whether this value marks a point range, which shadows the ranges
  /// contained in it.
  point!: boolean
}

RangeValue.prototype.startSide = RangeValue.prototype.endSide = 0
RangeValue.prototype.point = false
RangeValue.prototype.startMapMode = RangeValue.prototype.endMapMode = MapMode.TrackDel

/// A range associates a value with a range of positions.
export class Range<T extends RangeValue> {
  constructor(readonly from: number, readonly to: number, readonly value: T) {}
}

/// Collection of methods used when comparing range sets.
export interface RangeComparator<T extends RangeValue> {
  /// Notifies the comparator that the given range has the given set
  /// of values associated with it.
  compareRange(from: number, to: number, activeA: T[], activeB: T[]): void
  /// Notification for a point range.
  comparePoint(from: number, to: number, byA: T | null, byB: T | null): void
}

/// Methods used when iterating over a single range set. The entire
/// iterated range will be covered with either `span` or `point`
/// calls.
export interface RangeIterator<T extends RangeValue> {
  /// Called for any ranges not covered by point decorations. `active`
  /// holds the values that the range is marked with (and may be
  /// empty).
  span(from: number, to: number, active: readonly T[]): void
  /// Called when going over a point decoration. `openStart` and
  /// `openEnd` indicate whether the point decoration exceeded the
  /// range we're iterating over at its start and end.
  point(from: number, to: number, value: T, openStart: boolean, openEnd: boolean): void
}

const ChunkSize = 250, Far = 1e9

class Chunk<T extends RangeValue> {
  constructor(readonly from: readonly number[],
              readonly to: readonly number[],
              readonly value: readonly T[]) {}

  get length() { return this.to[this.to.length - 1] }

  // With side == -1, return the first index where to >= pos. When
  // side == 1, the first index where from > pos.
  findIndex(pos: number, end: -1 | 1, side = end * Far, startAt = 0) {
    if (pos <= 0) return startAt
    let arr = end < 0 ? this.to : this.from
    for (let lo = startAt, hi = arr.length;;) {
      if (lo == hi) return lo
      let mid = (lo + hi) >> 1
      let diff = arr[mid] - pos || (end < 0 ? this.value[mid].startSide : this.value[mid].endSide) - side
      if (mid == lo) return diff >= 0 ? lo : hi
      if (diff >= 0) hi = mid
      else lo = mid + 1
    }
  }

  between(offset: number, from: number, to: number, f: (from: number, to: number, value: T) => void | false): void | false {
    for (let i = this.findIndex(from, -1), e = this.findIndex(to, 1, undefined, i); i < e; i++)
      if (f(this.from[i] + offset, this.to[i] + offset, this.value[i]) === false) return false
  }

  map(offset: number, changes: ChangeSet) {
    let value: T[] = [], from = [], to = [], newPos = -1
    for (let i = 0; i < this.value.length; i++) {
      let val = this.value[i]
      let newFrom = changes.mapPos(this.from[i] + offset, val.startSide, val.startMapMode)
      let newTo = changes.mapPos(this.to[i] + offset, val.endSide, val.endMapMode)
      if (newTo < 0) {
        if (newFrom < 0) continue
        newTo = -(newTo + 1)
      }
      if (newFrom < 0) newFrom = -(newFrom + 1)
      if ((newTo - newFrom || val.endSide - val.startSide) < 0) continue
      if (newPos < 0) newPos = newFrom
      value.push(val)
      from.push(newFrom - newPos)
      to.push(newTo - newPos)
    }
    return {mapped: value.length ? new Chunk(from, to, value) : null, pos: newPos}
  }
}

export type RangeCursor<T> = {
  next: () => void
  value: T | null
  from: number
  to: number
}

/// A range set stores a collection of [ranges](#rangeset.Range) in a
/// way that makes them efficient to [map](#rangeset.RangeSet.map) and
/// [update](#rangeset.RangeSet.update). This is an immutable data
/// structure.
export class RangeSet<T extends RangeValue> {
  /// @internal
  constructor(
    /// @internal
    readonly chunkPos: readonly number[],
    /// @internal
    readonly chunk: readonly Chunk<T>[],
    /// @internal
    readonly nextLayer: RangeSet<T> = RangeSet.empty
  ) {}

  /// @internal
  get length(): number {
    let last = this.chunk.length - 1
    return last < 0 ? 0 : Math.max(this.chunkEnd(last), this.nextLayer.length)
  }

  /// @internal
  get size(): number {
    if (this == RangeSet.empty) return 0
    let size = this.nextLayer.size
    for (let chunk of this.chunk) size += chunk.value.length
    return size
  }

  /// @internal
  chunkEnd(index: number) {
    return this.chunkPos[index] + this.chunk[index].length
  }

  update({add = [], filter, filterFrom = 0, filterTo = this.length}: {
    add?: readonly Range<T>[],
    filter?: (from: number, to: number, value: T) => boolean,
    filterFrom?: number,
    filterTo?: number
  }): RangeSet<T> {
    if (add.length == 0 && !filter) return this
    if (this == RangeSet.empty) return add.length ? RangeSet.of(add) : this

    let cur = new LayerCursor(this).goto(0), i = 0, spill = []
    let builder = new RangeSetBuilder<T>()
    while (cur.value || i < add.length) {
      if (i < add.length && (cur.from - add[i].from || cur.startSide - add[i].value.startSide) >= 0) {
        let range = add[i++]
        if (!builder.addInner(range.from, range.to, range.value)) spill.push(range)
      } else if (cur.rangeIndex == 1 && cur.chunkIndex < this.chunk.length &&
                 (i == add.length || this.chunkEnd(cur.chunkIndex) < add[i].from) &&
                 (!filter || filterFrom > this.chunkEnd(cur.chunkIndex) || filterTo < this.chunkPos[cur.chunkIndex]) &&
                 builder.addChunk(this.chunkPos[cur.chunkIndex], this.chunk[cur.chunkIndex])) {
        cur.nextChunk()
      } else {
        if (!filter || filterFrom > cur.to || filterTo < cur.from || filter(cur.from, cur.to, cur.value!)) {
          if (!builder.addInner(cur.from, cur.to, cur.value!))
            spill.push(new Range(cur.from, cur.to, cur.value!))
        }
        cur.next()
      }
    }

    return builder.finish(this.nextLayer == RangeSet.empty && !spill.length ? RangeSet.empty
                          : this.nextLayer.update({add: spill, filter, filterFrom, filterTo}))
  }

  /// Map this range set through a set of changes, return the new set.
  map(changes: ChangeSet): RangeSet<T> {
    if (changes.length == 0 || this == RangeSet.empty) return this

    let chunks = [], chunkPos = []
    for (let i = 0; i < this.chunk.length; i++) {
      let start = this.chunkPos[i], chunk = this.chunk[i]
      let touch = touchesChanges(start, start + chunk.length, changes.changes)
      if (touch == Touched.No) {
        chunks.push(chunk)
        chunkPos.push(changes.mapPos(start))
      } else if (touch == Touched.Yes) {
        let {mapped, pos} = chunk.map(start, changes)
        if (mapped) {
          chunks.push(mapped)
          chunkPos.push(pos)
        }
      }
    }
    let next = this.nextLayer.map(changes)
    return chunks.length == 0 ? next : new RangeSet(chunkPos, chunks, next)
  }

  /// Iterate over the ranges that touch the region `from` to `to`,
  /// calling `f` for each. There is no guarantee that the ranges will
  /// be reported in any order. When the callback returns `false`,
  /// iteration stops.
  between(from: number, to: number, f: (from: number, to: number, value: T) => void | false): void {
    if (this == RangeSet.empty) return
    for (let i = 0; i < this.chunk.length; i++) {
      let start = this.chunkPos[i], chunk = this.chunk[i]
      if (to >= start && from <= start + chunk.length &&
          chunk.between(start, from - start, to - start, f) === false) return
    }
    this.nextLayer.between(from, to, f)
  }

  /// Iterate over the ranges in the set that touch the area between
  /// from and to, ordered by their start position and side.
  iter(from: number = 0): RangeCursor<T> {
    return HeapCursor.from([this]).goto(from)
  }

  /// Iterate over two groups of sets, calling methods on `comparator`
  /// to notify it of possible differences. `textDiff` indicates how
  /// the underlying data changed between these ranges, and is needed
  /// to synchronize the iteration. `from` and `to` are coordinates in
  /// the _new_ space, after these changes.
  static compare<T extends RangeValue>(
    oldSets: readonly RangeSet<T>[], newSets: readonly RangeSet<T>[],
    from: number, to: number,
    textDiff: readonly ChangedRange[],
    comparator: RangeComparator<T>
  ) {
    let a = oldSets.filter(set => set != RangeSet.empty && newSets.indexOf(set) < 0)
    let b = newSets.filter(set => set != RangeSet.empty && oldSets.indexOf(set) < 0)
    let sharedChunks = findSharedChunks(a, b)
    let sideA = new SpanCursor(a, sharedChunks), sideB = new SpanCursor(b, sharedChunks)

    let oldPos = 0, newPos = 0
    for (let range of textDiff) {
      if (range.fromB >= from) {
        let clipFrom = Math.max(from, newPos), clipTo = Math.min(to, range.fromB)
        compare(sideA, oldPos + (clipFrom - newPos), sideB, clipFrom, clipTo - clipFrom, comparator)
      }
      oldPos = range.toA
      newPos = range.toB
      if (newPos > to) return
    }
    let clipFrom = Math.max(from, newPos)
    compare(sideA, oldPos + (clipFrom - newPos), sideB, clipFrom, to - clipFrom, comparator)
  }

  /// Iterate over a group of range sets at the same time, notifying
  /// the iterator about the ranges covering every given piece of
  /// content.
  static spans<T extends RangeValue>(sets: readonly RangeSet<T>[], from: number, to: number,
                                     iterator: RangeIterator<T>) {
    let cursor = new SpanCursor(sets).goto(from), pos = from
    for (;;) {
      let curTo = Math.min(cursor.to, to)
      if (cursor.point) iterator.point(pos, curTo, cursor.point, cursor.pointFrom < from, cursor.to > to)
      else if (curTo > pos) iterator.span(pos, curTo, cursor.active)
      if (cursor.to > to) break
      pos = cursor.to
      cursor.next()
    }
  }

  /// Create a range set for the given range or array of ranges.
  // FIXME determine and document sorting requirement
  static of<T extends RangeValue>(ranges: readonly Range<T>[] | Range<T>): RangeSet<T> {
    let build = new RangeSetBuilder<T>()
    for (let range of ranges instanceof Range ? [ranges] : ranges)
      build.add(range.from, range.to, range.value)
    return build.finish()
  }

  /// The empty set of ranges.
  static empty = new RangeSet<any>([], [], null as any)
}

;(RangeSet.empty as any).nextLayer = RangeSet.empty

export class RangeSetBuilder<T extends RangeValue> {
  private chunks: Chunk<T>[] = []
  private chunkPos: number[] = []
  private chunkStart = -1
  private last: T | null = null
  private lastFrom = -Far
  private lastTo = -Far
  private from: number[] = []
  private to: number[] = []
  private value: T[] = []
  private nextLayer: RangeSetBuilder<T> | null = null

  private finishChunk(newArrays: boolean) {
    this.chunks.push(new Chunk(this.from, this.to, this.value))
    this.chunkPos.push(this.chunkStart)
    this.chunkStart = -1
    if (newArrays) { this.from = []; this.to = []; this.value = [] }
  }

  add(from: number, to: number, value: T) {
    if (!this.addInner(from, to, value))
      (this.nextLayer || (this.nextLayer = new RangeSetBuilder)).add(from, to, value)
  }

  /// @internal
  addInner(from: number, to: number, value: T) {
    let diff = from - this.lastTo || value.startSide - this.last!.endSide
    if (diff <= 0 && (from - this.lastFrom || value.startSide - this.last!.startSide) < 0)
      throw new Error("Ranges must be added sorted by `from` position and `startSide`")
    if (diff < 0) return false
    if (this.from.length == ChunkSize) this.finishChunk(true)
    if (this.chunkStart < 0) this.chunkStart = from
    this.from.push(from - this.chunkStart)
    this.to.push(to - this.chunkStart)
    this.last = value
    this.lastFrom = from
    this.lastTo = to
    this.value.push(value)
    return true
  }

  addChunk(from: number, chunk: Chunk<T>) {
    if ((from - this.lastTo || chunk.value[0].startSide - this.last!.endSide) < 0) return false
    if (this.from.length) this.finishChunk(true)
    this.chunks.push(chunk)
    this.chunkPos.push(from)
    let last = chunk.value.length - 1
    this.last = chunk.value[last]
    this.lastFrom = chunk.from[last] + from
    this.lastTo = chunk.to[last] + from
    return true
  }

  finish(next: RangeSet<T> = RangeSet.empty): RangeSet<T> {
    if (this.from.length) this.finishChunk(false)
    if (this.chunks.length == 0) return next
    let result = new RangeSet(this.chunkPos, this.chunks, this.nextLayer ? this.nextLayer.finish(next) : next)
    this.from = null as any // Make sure further `add` calls produce errors
    return result
  }
}

function findSharedChunks(a: readonly RangeSet<any>[], b: readonly RangeSet<any>[]) {
  let inA = new Map<Chunk<any>, number>()
  for (let set of a) for (let i = 0; i < set.chunk.length; i++)
    inA.set(set.chunk[i], set.chunkPos[i])
  let shared = new Set<Chunk<any>>()
  for (let set of b) for (let i = 0; i < set.chunk.length; i++)
    if (inA.get(set.chunk[i]) == set.chunkPos[i])
      shared.add(set.chunk[i])
  return shared
}

class LayerCursor<T extends RangeValue> {
  from!: number
  to!: number
  value!: T | null

  chunkIndex!: number
  rangeIndex!: number

  constructor(readonly layer: RangeSet<T>, readonly skip: Set<Chunk<T>> | null = null) {}

  get startSide() { return this.value ? this.value.startSide : 0 }
  get endSide() { return this.value ? this.value.endSide : 0 }

  goto(pos: number, side: number = -Far) {
    this.chunkIndex = this.rangeIndex = 0
    this.gotoInner(pos, side, false)
    return this
  }

  gotoInner(pos: number, side: number, forward: boolean) {
    while (this.chunkIndex < this.layer.chunk.length &&
           (this.skip && this.skip.has(this.layer.chunk[this.chunkIndex]) ||
            this.layer.chunkEnd(this.chunkIndex) < pos)) {
      this.chunkIndex++
      forward = false
    }
    let rangeIndex = this.chunkIndex == this.layer.chunk.length ? 0
      : this.layer.chunk[this.chunkIndex].findIndex(pos - this.layer.chunkPos[this.chunkIndex], -1, side)
    if (!forward || this.rangeIndex < rangeIndex) this.rangeIndex = rangeIndex
    this.next()
  }

  forward(pos: number, side: number) {
    if ((this.to - pos || this.endSide - side) < 0)
      this.gotoInner(pos, side, true)
  }

  next() {
    if (this.chunkIndex == this.layer.chunk.length) {
      this.from = this.to = Far
      this.value = null
    } else {
      let chunkPos = this.layer.chunkPos[this.chunkIndex], chunk = this.layer.chunk[this.chunkIndex]
      let from = chunkPos + chunk.from[this.rangeIndex]
      this.from = from
      this.to = chunkPos + chunk.to[this.rangeIndex]
      this.value = chunk.value[this.rangeIndex]
      if (++this.rangeIndex == chunk.value.length) {
        this.chunkIndex++
        if (this.skip) {
          while (this.chunkIndex < this.layer.chunk.length && this.skip.has(this.layer.chunk[this.chunkIndex]))
            this.chunkIndex++
        }
        this.rangeIndex = 0
      }
    }
  }

  nextChunk() {
    this.chunkIndex++
    this.rangeIndex = 0
    this.next()
  }

  compare(other: LayerCursor<T>) {
    return this.from - other.from || this.startSide - other.startSide || this.to - other.to || this.endSide - other.endSide
  }
}

class HeapCursor<T extends RangeValue> {
  from!: number
  to!: number
  value!: T | null
  
  constructor(readonly heap: LayerCursor<T>[]) {}

  static from<T extends RangeValue>(
    sets: readonly RangeSet<T>[],
    skip: Set<Chunk<T>> | null = null
  ): HeapCursor<T> | LayerCursor<T> {
    let heap = []
    for (let set of sets)
      for (let cur = set; cur != RangeSet.empty; cur = cur.nextLayer)
        heap.push(new LayerCursor(cur, skip))
    return heap.length == 1 ? heap[0] : new HeapCursor(heap)
  }

  get startSide() { return this.value ? this.value.startSide : 0 }

  goto(pos: number, side: number = -Far) {
    for (let cur of this.heap) cur.goto(pos, side)
    for (let i = this.heap.length >> 1; i >= 0; i--) heapBubble(this.heap, i)
    this.next()
    return this
  }

  forward(pos: number, side: number) {
    for (let cur of this.heap) cur.forward(pos, side)
    for (let i = this.heap.length >> 1; i >= 0; i--) heapBubble(this.heap, i)
    if ((this.to - pos || this.value!.endSide - side) < 0) this.next()
  }    

  next() {
    if (this.heap.length == 0) {
      this.from = this.to = Far
      this.value = null
    } else {
      let top = this.heap[0]
      this.from = top.from
      this.to = top.to
      this.value = top.value
      top.next()
      if (top.value == null) heapPop(this.heap)
      else heapBubble(this.heap, 0)
    }
  }
}

function heapPop<T extends RangeValue>(heap: LayerCursor<T>[]) {
  let last = heap.pop()!
  if (heap.length == 0) return
  heap[0] = last
  heapBubble(heap, 0)
}

function heapBubble<T extends RangeValue>(heap: LayerCursor<T>[], index: number) {
  for (let cur = heap[index];;) {
    let childIndex = (index << 1) + 1
    if (childIndex >= heap.length) break
    let child = heap[childIndex]
    if (childIndex + 1 < heap.length && child.compare(heap[childIndex + 1]) >= 0) {
      child = heap[childIndex + 1]
      childIndex++
    }
    if (cur.compare(child) < 0) break
    heap[childIndex] = cur
    heap[index] = child
    index = childIndex
  }
}

class SpanCursor<T extends RangeValue> {
  cursor: HeapCursor<T> | LayerCursor<T>

  active: T[] = []
  activeTo: number[] = []
  minActive = -1

  // A currently active point range, if any
  point: T | null = null
  pointFrom = 0

  to = -Far
  endSide = 0

  constructor(sets: readonly RangeSet<T>[], skip: Set<Chunk<T>> | null = null) {
    this.cursor = HeapCursor.from(sets, skip)
  }

  goto(pos: number, side: number = -Far) {
    this.cursor.goto(pos, side)
    this.active.length = this.activeTo.length = 0
    this.minActive = -1
    this.to = pos
    this.endSide = side
    this.next()
    return this
  }

  forward(pos: number, side: number) {
    while (this.minActive > -1 && (this.activeTo[this.minActive] - pos || this.active[this.minActive].endSide - side) < 0)
      this.removeActive(this.minActive)
    this.cursor.forward(pos, side)
  }

  removeActive(index: number) {
    remove(this.active, index)
    remove(this.activeTo, index)
    this.minActive = findMinIndex(this.active, this.activeTo)
  }

  // After calling this, if `this.point` != null, the next range is a
  // point. Otherwise, it's a regular range, covered by `this.active`.
  next() {
    let from = this.to
    this.point = null
    for (;;) {
      let a = this.minActive
      if (a > -1 && (this.activeTo[a] - this.cursor.from || this.active[a].endSide - this.cursor.startSide) < 0) {
        if (this.activeTo[a] > from) {
          this.to = this.activeTo[a]
          this.endSide = this.active[a].endSide
          break
        }
        this.removeActive(a)
      } else if (!this.cursor.value) {
        this.to = this.endSide = Far
        break
      } else if (this.cursor.from > from) {
        this.to = this.cursor.from
        this.endSide = this.cursor.startSide
        break
      } else {
        let nextVal = this.cursor.value
        if (!nextVal.point) { // Opening a range
          this.active.push(nextVal)
          this.activeTo.push(this.cursor.to)
          this.minActive = findMinIndex(this.active, this.activeTo)
          this.cursor.next()
        } else { // New point
          this.point = nextVal
          this.pointFrom = this.cursor.from
          this.to = this.cursor.to
          this.endSide = nextVal.endSide
          this.cursor.next()
          this.forward(this.to, this.endSide)
          break
        }
      }
    }
  }
}

function compare<T extends RangeValue>(a: SpanCursor<T>, startA: number,
                                       b: SpanCursor<T>, startB: number,
                                       length: number,
                                       comparator: RangeComparator<T>) {
  a.goto(startA)
  b.goto(startB)
  let endB = startB + length
  let pos = startB, dPos = startB - startA
  for (;;) {
    let diff = (a.to + dPos) - b.to || a.endSide - b.endSide
    let end = diff < 0 ? a.to + dPos : b.to, clipEnd = Math.min(end, endB)
    if (a.point || b.point) {
      if (!(a.point && b.point && (a.point == b.point || a.point.eq(b.point))))
        comparator.comparePoint(pos, clipEnd, a.point, b.point)
    } else {
      if (clipEnd > pos && !sameSet(a.active, b.active)) comparator.compareRange(pos, clipEnd, a.active, b.active)
    }
    if (end > endB) break
    pos = end
    if (diff <= 0) a.next()
    if (diff >= 0) b.next()
  }
}

function sameSet<T extends RangeValue>(a: T[], b: T[]) {
  if (a.length != b.length) return false
  outer: for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++)
      if (a[i] == b[i] || a[i].eq(b[j])) continue outer
    return false
  }
  return true
}

function remove<T>(array: T[], index: number) {
  let last = array.pop()!
  if (index != array.length) array[index] = last
}

function findMinIndex(value: RangeValue[], array: number[]) {
  let found = -1, foundPos = Far
  for (let i = 0; i < array.length; i++)
    if ((array[i] - foundPos || value[i].endSide - value[found].endSide) < 0) {
    found = i
    foundPos = array[i]
  }
  return found
}

const enum Touched {Yes, No, Covered}

function touchesChanges(from: number, to: number, changes: readonly Change[]): Touched {
  let result = Touched.No
  for (let change of changes) {
    if (change.to >= from && change.from <= to) {
      if (change.from < from && change.to > to) result = Touched.Covered
      else if (result == Touched.No) result = Touched.Yes
    }
    let diff = change.length - (change.to - change.from)
    if (from > change.from) from += diff
    if (to > change.to) to += diff
  }
  return result
}
