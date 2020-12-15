import {ChangeDesc, MapMode} from "@codemirror/next/state"

/// Each range is associated with a value, which must inherit from
/// this class.
export abstract class RangeValue {
  /// Compare this value with another value. The default
  /// implementation compares by identity.
  eq(other: RangeValue) { return this == other }
  /// The bias value at the start of the range. Determines how the
  /// range is positioned relative to other ranges starting at this
  /// position. Defaults to 0.
  startSide!: number
  /// The bias value at the end of the range. Defaults to 0.
  endSide!: number

  /// The mode with which the location of the range should be mapped
  /// when it's `from` and `to` are the same, to decide whether a
  /// change deletes the range. Defaults to `MapMode.TrackDel`.
  mapMode!: MapMode
  /// Whether this value marks a point range, which shadows the ranges
  /// contained in it.
  point!: boolean

  /// Create a [range](#rangeset.Range) with this value.
  range(from: number, to = from) { return new Range(from, to, this) }
}

RangeValue.prototype.startSide = RangeValue.prototype.endSide = 0
RangeValue.prototype.point = false
RangeValue.prototype.mapMode = MapMode.TrackDel

/// A range associates a value with a range of positions.
export class Range<T extends RangeValue> {
  /// @internal
  constructor(
    /// The range's start position.
    readonly from: number,
    /// Its end position.
    readonly to: number,
    /// The value associated with this range.
    readonly value: T) {}
}

function cmpRange<T extends RangeValue>(a: Range<T>, b: Range<T>) {
  return a.from - b.from || a.value.startSide - b.value.startSide
}

/// Collection of methods used when comparing range sets.
export interface RangeComparator<T extends RangeValue> {
  /// Notifies the comparator that the given range has the given set
  /// of values associated with it.
  compareRange(from: number, to: number, activeA: T[], activeB: T[]): void
  /// Notification for a point range.
  comparePoint(from: number, to: number, byA: T | null, byB: T | null): void
  /// Can be used to ignore all non-point ranges and points below a
  /// given size. Specify 0 to get all points.
  minPointSize?: number
}

/// Methods used when iterating over the spans created by a set of
/// ranges. The entire iterated range will be covered with either
/// `span` or `point` calls.
export interface SpanIterator<T extends RangeValue> {
  /// Called for any ranges not covered by point decorations. `active`
  /// holds the values that the range is marked with (and may be
  /// empty). `openStart` indicates how many of those ranges are open
  /// (continued) at the start of the span.
  span(from: number, to: number, active: readonly T[], openStart: number): void
  /// Called when going over a point decoration. The active range
  /// decorations that cover the point and have a higher precedence
  /// are provided in `active`. The open count in `openStart` counts
  /// the number of those ranges that started before the point and. If
  /// the point started before the iterated range, `openStart` will be
  /// `active.length + 1` to signal this.
  point(from: number, to: number, value: T, active: readonly T[], openStart: number): void
  /// When given and greater than -1, only points of at least this
  /// size are taken into account.
  minPointSize?: number
}

const enum C {
  // The maximum amount of ranges to store in a single chunk
  ChunkSize = 250,
  // Chunks with points of this size are never skipped during
  // compare, since moving past those points is likely to speed
  // up, rather than slow down, the comparison.
  BigPointSize = 500,
  // A large (fixnum) value to use for max/min values.
  Far = 1e9
}

class Chunk<T extends RangeValue> {
  constructor(readonly from: readonly number[],
              readonly to: readonly number[],
              readonly value: readonly T[],
              // Chunks are marked with the largest point that occurs
              // in them (or -1 for no points), so that scans that are
              // only interested in points (such as the
              // heightmap-related logic) can skip range-only chunks.
              readonly maxPoint: number) {}

  get length() { return this.to[this.to.length - 1] }

  // With side == -1, return the first index where to >= pos. When
  // side == 1, the first index where from > pos.
  findIndex(pos: number, end: -1 | 1, side = end * C.Far, startAt = 0) {
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

  map(offset: number, changes: ChangeDesc) {
    let value: T[] = [], from = [], to = [], newPos = -1, maxPoint = -1
    for (let i = 0; i < this.value.length; i++) {
      let val = this.value[i], curFrom = this.from[i] + offset, curTo = this.to[i] + offset, newFrom, newTo
      if (curFrom == curTo) {
        let mapped = changes.mapPos(curFrom, val.startSide, val.mapMode)
        if (mapped == null) continue
        newFrom = newTo = mapped
      } else {
        newFrom = changes.mapPos(curFrom, val.startSide)
        newTo = changes.mapPos(curTo, val.endSide)
        if (newFrom > newTo || newFrom == newTo && val.startSide > 0 && val.endSide <= 0) continue
      }
      if ((newTo - newFrom || val.endSide - val.startSide) < 0) continue
      if (newPos < 0) newPos = newFrom
      if (val.point) maxPoint = Math.max(maxPoint, newTo - newFrom)
      value.push(val)
      from.push(newFrom - newPos)
      to.push(newTo - newPos)
    }
    return {mapped: value.length ? new Chunk(from, to, value, maxPoint) : null, pos: newPos}
  }
}

/// A range cursor is an object that moves to the next range every
/// time you call `next` on it. Note that, unlike ES6 iterators, these
/// start out pointing at the first element, so you should call `next`
/// only after reading the first range (if any).
export type RangeCursor<T> = {
  /// Move the iterator forward.
  next: () => void
  /// The next range's value. Holds `null` when the cursor has reached
  /// its end.
  value: T | null
  /// The next range's start position.
  from: number
  /// The next end position.
  to: number
}

type RangeSetUpdate<T extends RangeValue> = {
  /// An array of ranges to add. If given, this should be sorted by
  /// `from` position and `startSide` unless
  /// [`sort`](#rangeset.RangeSet.update^updateSpec.sort) is given as
  /// `true`.
  add?: readonly Range<T>[]
  /// Indicates whether the library should sort the ranges in `add`.
  sort?: boolean
  /// Filter the ranges already in the set. Only those for which this
  /// function returns `true` are kept.
  filter?: (from: number, to: number, value: T) => boolean,
  /// Can be used to limit the range on which the filter is
  /// applied. Filtering only a small range, as opposed to the entire
  /// set, can make updates cheaper.
  filterFrom?: number
  /// The end position to applly the filter to.
  filterTo?: number
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
    readonly nextLayer: RangeSet<T> = RangeSet.empty,
    /// @internal
    readonly maxPoint: number
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

  /// Update the range set, optionally adding new ranges or filtering
  /// out existing ones.
  ///
  /// (The extra type parameter is just there as a kludge to work
  /// around TypeScript variance issues that prevented `RangeSet<X>`
  /// from being a subtype of `RangeSet<Y>` when `X` is a subtype of
  /// `Y`.)
  update<U extends T>(updateSpec: RangeSetUpdate<U>): RangeSet<T> {
    let {add = [], sort = false, filterFrom = 0, filterTo = this.length} = updateSpec
    let filter = updateSpec.filter as undefined | ((from: number, to: number, value: T) => boolean)
    if (add.length == 0 && !filter) return this
    if (sort) add.slice().sort(cmpRange)
    if (this == RangeSet.empty) return add.length ? RangeSet.of(add) : this

    let cur = new LayerCursor(this, null, -1).goto(0), i = 0, spill: Range<T>[] = []
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

    return builder.finishInner(this.nextLayer == RangeSet.empty && !spill.length ? RangeSet.empty
                               : this.nextLayer.update<T>({add: spill, filter, filterFrom, filterTo}))
  }

  /// Map this range set through a set of changes, return the new set.
  map(changes: ChangeDesc): RangeSet<T> {
    if (changes.length == 0 || this == RangeSet.empty) return this

    let chunks = [], chunkPos = [], maxPoint = -1
    for (let i = 0; i < this.chunk.length; i++) {
      let start = this.chunkPos[i], chunk = this.chunk[i]
      let touch = changes.touchesRange(start, start + chunk.length)
      if (touch === false) {
        maxPoint = Math.max(maxPoint, chunk.maxPoint)
        chunks.push(chunk)
        chunkPos.push(changes.mapPos(start))
      } else if (touch === true) {
        let {mapped, pos} = chunk.map(start, changes)
        if (mapped) {
          maxPoint = Math.max(maxPoint, mapped.maxPoint)
          chunks.push(mapped)
          chunkPos.push(pos)
        }
      }
    }
    let next = this.nextLayer.map(changes)
    return chunks.length == 0 ? next : new RangeSet(chunkPos, chunks, next, maxPoint)
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

  /// Iterate over the ranges in this set, in order, including all
  /// ranges that end at or after `from`.
  iter(from: number = 0): RangeCursor<T> {
    return HeapCursor.from([this]).goto(from)
  }

  /// Iterate over the given sets, starting from `from`.
  static iter<T extends RangeValue>(sets: readonly RangeSet<T>[], from: number = 0): RangeCursor<T> {
    return HeapCursor.from(sets).goto(from)
  }

  /// Iterate over two groups of sets, calling methods on `comparator`
  /// to notify it of possible differences. `textDiff` indicates how
  /// the underlying data changed between these ranges, and is needed
  /// to synchronize the iteration. `from` and `to` are coordinates in
  /// the _new_ space, after these changes.
  static compare<T extends RangeValue>(
    oldSets: readonly RangeSet<T>[], newSets: readonly RangeSet<T>[],
    textDiff: ChangeDesc,
    comparator: RangeComparator<T>
  ) {
    let minPoint = comparator.minPointSize ?? -1
    let a = oldSets.filter(set => set.maxPoint >= C.BigPointSize ||
                           set != RangeSet.empty && newSets.indexOf(set) < 0 && set.maxPoint >= minPoint)
    let b = newSets.filter(set => set.maxPoint >= C.BigPointSize ||
                           set != RangeSet.empty && oldSets.indexOf(set) < 0 && set.maxPoint >= minPoint)
    let sharedChunks = findSharedChunks(a, b)

    let sideA = new SpanCursor(a, sharedChunks, minPoint)
    let sideB = new SpanCursor(b, sharedChunks, minPoint)

    textDiff.iterGaps((fromA, fromB, length) => compare(sideA, fromA, sideB, fromB, length, comparator))
    if (textDiff.empty && textDiff.length == 0) compare(sideA, 0, sideB, 0, 0, comparator)
  }

  /// Iterate over a group of range sets at the same time, notifying
  /// the iterator about the ranges covering every given piece of
  /// content. Returns the open count (see
  /// [`SpanIterator.span`](#rangeset.SpanIterator.span)) at the end
  /// of the iteration.
  static spans<T extends RangeValue>(sets: readonly RangeSet<T>[], from: number, to: number,
                                     iterator: SpanIterator<T>): number {
    let cursor = new SpanCursor(sets, null, iterator.minPointSize ?? -1).goto(from), pos = from
    let open = cursor.openStart
    for (;;) {
      let curTo = Math.min(cursor.to, to)
      if (cursor.point) {
        iterator.point(pos, curTo, cursor.point, cursor.activeForPoint(cursor.to), open)
        open = cursor.openEnd(curTo) + (cursor.to > curTo ? 1 : 0)
      } else if (curTo > pos) {
        iterator.span(pos, curTo, cursor.active, open)
        open = cursor.openEnd(curTo)
      }
      if (cursor.to > to) break
      pos = cursor.to
      cursor.next()
    }
    return open
  }

  /// Create a range set for the given range or array of ranges. By
  /// default, this expects the ranges to be _sorted_ (by start
  /// position and, if two start at the same position,
  /// `value.startSide`). You can pass `true` as second argument to
  /// cause the method to sort them.
  static of<T extends RangeValue>(ranges: readonly Range<T>[] | Range<T>, sort = false): RangeSet<T> {
    let build = new RangeSetBuilder<T>()
    for (let range of ranges instanceof Range ? [ranges] : sort ? ranges.slice().sort(cmpRange) : ranges)
      build.add(range.from, range.to, range.value)
    return build.finish()
  }

  /// The empty set of ranges.
  static empty = new RangeSet<any>([], [], null as any, -1)
}

// Awkward patch-up to create a cyclic structure.
;(RangeSet.empty as any).nextLayer = RangeSet.empty

/// A range set builder is a data structure that helps build up a
/// [range set](#rangeset.RangeSet) directly, without first allocating
/// an array of [`Range`](#rangeset.Range) objects.
export class RangeSetBuilder<T extends RangeValue> {
  private chunks: Chunk<T>[] = []
  private chunkPos: number[] = []
  private chunkStart = -1
  private last: T | null = null
  private lastFrom = -C.Far
  private lastTo = -C.Far
  private from: number[] = []
  private to: number[] = []
  private value: T[] = []
  private maxPoint = -1
  private setMaxPoint = -1
  private nextLayer: RangeSetBuilder<T> | null = null

  private finishChunk(newArrays: boolean) {
    this.chunks.push(new Chunk(this.from, this.to, this.value, this.maxPoint))
    this.chunkPos.push(this.chunkStart)
    this.chunkStart = -1
    this.setMaxPoint = Math.max(this.setMaxPoint, this.maxPoint)
    this.maxPoint = -1
    if (newArrays) { this.from = []; this.to = []; this.value = [] }
  }

  /// Create an empty builder.
  constructor() {}

  /// Add a range. Ranges should be added in sorted (by `from` and
  /// `value.startSide`) order.
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
    if (this.from.length == C.ChunkSize) this.finishChunk(true)
    if (this.chunkStart < 0) this.chunkStart = from
    this.from.push(from - this.chunkStart)
    this.to.push(to - this.chunkStart)
    this.last = value
    this.lastFrom = from
    this.lastTo = to
    this.value.push(value)
    if (value.point) this.maxPoint = Math.max(this.maxPoint, to - from)
    return true
  }

  /// @internal
  addChunk(from: number, chunk: Chunk<T>) {
    if ((from - this.lastTo || chunk.value[0].startSide - this.last!.endSide) < 0) return false
    if (this.from.length) this.finishChunk(true)
    this.setMaxPoint = Math.max(this.setMaxPoint, chunk.maxPoint)
    this.chunks.push(chunk)
    this.chunkPos.push(from)
    let last = chunk.value.length - 1
    this.last = chunk.value[last]
    this.lastFrom = chunk.from[last] + from
    this.lastTo = chunk.to[last] + from
    return true
  }

  /// Finish the range set. Returns the new set. The builder can't be
  /// used anymore after this has been called.
  finish() { return this.finishInner(RangeSet.empty) }

  /// @internal
  finishInner(next: RangeSet<T>): RangeSet<T> {
    if (this.from.length) this.finishChunk(false)
    if (this.chunks.length == 0) return next
    let result = new RangeSet(this.chunkPos, this.chunks,
                              this.nextLayer ? this.nextLayer.finishInner(next) : next, this.setMaxPoint)
    this.from = null as any // Make sure further `add` calls produce errors
    return result
  }
}

function findSharedChunks(a: readonly RangeSet<any>[], b: readonly RangeSet<any>[]) {
  let inA = new Map<Chunk<any>, number>()
  for (let set of a) for (let i = 0; i < set.chunk.length; i++)
    if (set.chunk[i].maxPoint < C.BigPointSize) inA.set(set.chunk[i], set.chunkPos[i])
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

  constructor(readonly layer: RangeSet<T>,
              readonly skip: Set<Chunk<T>> | null,
              readonly minPoint: number,
              readonly rank = 0) {}

  get startSide() { return this.value ? this.value.startSide : 0 }
  get endSide() { return this.value ? this.value.endSide : 0 }

  goto(pos: number, side: number = -C.Far) {
    this.chunkIndex = this.rangeIndex = 0
    this.gotoInner(pos, side, false)
    return this
  }

  gotoInner(pos: number, side: number, forward: boolean) {
    while (this.chunkIndex < this.layer.chunk.length) {
      let next = this.layer.chunk[this.chunkIndex]
      if (!(this.skip && this.skip.has(next) ||
            this.layer.chunkEnd(this.chunkIndex) < pos ||
            next.maxPoint < this.minPoint)) break
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
    for (;;) {
      if (this.chunkIndex == this.layer.chunk.length) {
        this.from = this.to = C.Far
        this.value = null
        break
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
        if (this.minPoint < 0 || this.value.point && this.to - this.from >= this.minPoint) break
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
  rank!: number
  
  constructor(readonly heap: LayerCursor<T>[]) {}

  static from<T extends RangeValue>(
    sets: readonly RangeSet<T>[],
    skip: Set<Chunk<T>> | null = null,
    minPoint: number = -1
  ): HeapCursor<T> | LayerCursor<T> {
    let heap = []
    for (let i = 0; i < sets.length; i++) {
      for (let cur = sets[i]; cur != RangeSet.empty; cur = cur.nextLayer) {
        if (cur.maxPoint >= minPoint)
          heap.push(new LayerCursor(cur, skip, minPoint, i))
      }
    }
    return heap.length == 1 ? heap[0] : new HeapCursor(heap)
  }

  get startSide() { return this.value ? this.value.startSide : 0 }

  goto(pos: number, side: number = -C.Far) {
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
      this.from = this.to = C.Far
      this.value = null
      this.rank = -1
    } else {
      let top = this.heap[0]
      this.from = top.from
      this.to = top.to
      this.value = top.value
      this.rank = top.rank
      if (top.value) top.next()
      heapBubble(this.heap, 0)
    }
  }
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
  activeRank: number[] = []
  minActive = -1

  // A currently active point range, if any
  point: T | null = null
  pointFrom = 0
  pointRank = 0

  to = -C.Far
  endSide = 0
  openStart = -1

  constructor(sets: readonly RangeSet<T>[],
              skip: Set<Chunk<T>> | null,
              readonly minPoint: number) {
    this.cursor = HeapCursor.from(sets, skip, minPoint)
  }

  goto(pos: number, side: number = -C.Far) {
    this.cursor.goto(pos, side)
    this.active.length = this.activeTo.length = this.activeRank.length = 0
    this.minActive = -1
    this.to = pos
    this.endSide = side
    this.openStart = -1
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
    remove(this.activeRank, index)
    this.minActive = findMinIndex(this.active, this.activeTo)
  }

  addActive(trackOpen: number[] | null) {
    let i = 0, {value, to, rank} = this.cursor
    while (i < this.activeRank.length && this.activeRank[i] <= rank) i++
    insert(this.active, i, value)
    insert(this.activeTo, i, to)
    insert(this.activeRank, i, rank)
    if (trackOpen) insert(trackOpen, i, this.cursor.from)
    this.minActive = findMinIndex(this.active, this.activeTo)
  }

  // After calling this, if `this.point` != null, the next range is a
  // point. Otherwise, it's a regular range, covered by `this.active`.
  next() {
    let from = this.to
    this.point = null
    let trackOpen = this.openStart < 0 ? [] : null, trackExtra = 0
    for (;;) {
      let a = this.minActive
      if (a > -1 && (this.activeTo[a] - this.cursor.from || this.active[a].endSide - this.cursor.startSide) < 0) {
        if (this.activeTo[a] > from) {
          this.to = this.activeTo[a]
          this.endSide = this.active[a].endSide
          break
        }
        this.removeActive(a)
        if (trackOpen) remove(trackOpen, a)
      } else if (!this.cursor.value) {
        this.to = this.endSide = C.Far
        break
      } else if (this.cursor.from > from) {
        this.to = this.cursor.from
        this.endSide = this.cursor.startSide
        break
      } else {
        let nextVal = this.cursor.value
        if (!nextVal.point) { // Opening a range
          this.addActive(trackOpen)
          this.cursor.next()
        } else { // New point
          this.point = nextVal
          this.pointFrom = this.cursor.from
          this.pointRank = this.cursor.rank
          this.to = this.cursor.to
          this.endSide = nextVal.endSide
          if (this.cursor.from < from) trackExtra = 1
          this.cursor.next()
          if (this.to > from) this.forward(this.to, this.endSide)
          break
        }
      }
    }
    if (trackOpen) {
      let openStart = 0
      while (openStart < trackOpen.length && trackOpen[openStart] < from) openStart++
      this.openStart = openStart + trackExtra
    }
  }

  activeForPoint(to: number) {
    if (!this.active.length) return this.active
    let active = []
    for (let i = 0; i < this.active.length; i++) {
      if (this.activeRank[i] > this.pointRank) break
      if (this.activeTo[i] > to || this.activeTo[i] == to && this.active[i].endSide > this.point!.endSide)
        active.push(this.active[i])
    }
    return active
  }

  openEnd(to: number) {
    let open = 0
    while (open < this.activeTo.length && this.activeTo[open] > to) open++
    return open
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
      if (clipEnd > pos && !sameValues(a.active, b.active)) comparator.compareRange(pos, clipEnd, a.active, b.active)
    }
    if (end > endB) break
    pos = end
    if (diff <= 0) a.next()
    if (diff >= 0) b.next()
  }
}

function sameValues<T extends RangeValue>(a: T[], b: T[]) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] != b[i] && !a[i].eq(b[i])) return false
  return true
}

function remove<T>(array: T[], index: number) {
  for (let i = index, e = array.length - 1; i < e; i++) array[i] = array[i + 1]
  array.pop()
}

function insert<T>(array: T[], index: number, value: T) {
  for (let i = array.length - 1; i >= index; i--) array[i + 1] = array[i]
  array[index] = value
}

function findMinIndex(value: RangeValue[], array: number[]) {
  let found = -1, foundPos = C.Far
  for (let i = 0; i < array.length; i++)
    if ((array[i] - foundPos || value[i].endSide - value[found].endSide) < 0) {
    found = i
    foundPos = array[i]
  }
  return found
}
