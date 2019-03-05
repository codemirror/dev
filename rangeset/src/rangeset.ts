import {ChangeSet, Change, ChangedRange} from "../../state/src"

type A<T> = ReadonlyArray<T>

export abstract class RangeValue {
  abstract map(mapping: ChangeSet, from: number, to: number): Range<any> | null
  eq(other: RangeValue) { return this == other }
  startSide!: number
  endSide!: number
  point!: boolean
}

RangeValue.prototype.startSide = RangeValue.prototype.endSide = 0
RangeValue.prototype.point = false

export interface RangeComparator<T extends RangeValue> {
  compareRange(from: number, to: number, activeA: T[], activeB: T[]): void
  comparePoint(from: number, to: number, byA: T, byB: T | null): void
}

export interface RangeIterator<T extends RangeValue> {
  span(from: number, to: number, active: A<T>): void
  point(from: number, to: number, value: T, openStart: boolean, openEnd: boolean): void
  ignore(from: number, to: number, value: T): boolean
}

interface Heapable { heapPos: number; heapSide: number }

export class Range<T extends RangeValue> {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly value: T
  ) {}

  /** @internal */
  map(changes: ChangeSet, oldOffset: number, newOffset: number): Range<T> | null {
    let mapped = this.value.map(changes, this.from + oldOffset, this.to + oldOffset)
    if (mapped) {
      ;(mapped as any).from -= newOffset
      ;(mapped as any).to -= newOffset
    }
    return mapped
  }

  /** @internal */
  move(offset: number): Range<T> {
    return offset ? new Range(this.from + offset, this.to + offset, this.value) : this
  }

  /** @internal Here so that we can put active ranges on a heap
   * and take them off at their end */
  get heapPos() { return this.to }
  get heapSide() { return this.value.endSide }
}

const none: A<any> = []

function maybeNone<T>(array: A<T>): A<T> { return array.length ? array : none }

const BASE_NODE_SIZE_SHIFT = 5, BASE_NODE_SIZE = 1 << BASE_NODE_SIZE_SHIFT

export type RangeFilter<T> = (from: number, to: number, value: T) => boolean

export class RangeSet<T extends RangeValue> {
  // @internal
  constructor(
    // @internal The text length covered by this set
    public length: number,
    // The number of ranges in the set
    public size: number,
    // @internal The locally stored ranges—which are all of them
    // for leaf nodes, and the ones that don't fit in child sets for
    // non-leaves. Sorted by start position, then side.
    public local: A<Range<T>>,
    // @internal The child sets, in position order. Their total
    // length may be smaller than .length if the end is empty (never
    // greater)
    public children: A<RangeSet<T>>
  ) {}

  update(added: A<Range<T>> = none,
         filter: RangeFilter<T> | null = null,
         filterFrom: number = 0,
         filterTo: number = this.length): RangeSet<T> {
    let maxLen = added.reduce((l, d) => Math.max(l, d.to), this.length)
    return this.updateInner(added.length ? added.slice().sort(byPos) : added,
                            filter, filterFrom, filterTo, 0, maxLen)
  }

  /** @internal */
  updateInner(added: A<Range<T>>,
              filter: RangeFilter<T> | null,
              filterFrom: number, filterTo: number,
              offset: number, length: number): RangeSet<T> {
    // The new local ranges. Null means no changes were made yet
    let local: Range<T>[] | null = filterRanges<T>(this.local, filter, filterFrom, filterTo, offset)
    // The new array of child sets, if changed
    let children: RangeSet<T>[] | null = null

    let size = 0
    let decI = 0, pos = offset
    // Iterate over the child sets, applying filters and pushing added
    // ranges into them
    for (let i = 0; i < this.children.length; i++) {
      let child = this.children[i]
      let endPos = pos + child.length, localRanges: Range<T>[] | null = null
      while (decI < added.length) {
        let next = added[decI]
        if (next.from >= endPos) break
        decI++
        if (next.to > endPos) {
          if (!local) local = this.local.slice()
          insertSorted(local, next.move(-offset))
        } else {
          (localRanges || (localRanges = [])).push(next)
        }
      }
      let newChild = child
      if (localRanges || filter && filterFrom <= endPos && filterTo >= pos)
        newChild = newChild.updateInner(localRanges || none, filter, filterFrom, filterTo,
                                        pos, newChild.length)
      if (newChild != child)
        (children || (children = this.children.slice(0, i))).push(newChild)
      else if (children)
        children.push(newChild)
      size += newChild.size
      pos = endPos
    }

    // If nothing was actually updated, return the existing object
    if (!local && !children && decI == added.length) return this

    // Compute final size
    size += (local || this.local).length + added.length - decI

    // This is a small node—turn it into a flat leaf
    if (size <= BASE_NODE_SIZE)
      return collapseSet(children || this.children, local || this.local.slice(),
                         added, decI, offset, length)

    let childSize = Math.max(BASE_NODE_SIZE, size >> BASE_NODE_SIZE_SHIFT)
    if (decI < added.length) {
      if (!children) children = this.children.slice()
      if (!local) local = this.local.slice()
      appendRanges<T>(local, children, added, decI, offset, length, pos, childSize)
    }

    if (children) {
      if (!local) local = this.local.slice()
      rebalanceChildren(local, children, childSize)
    }

    return new RangeSet<T>(length, size, maybeNone(local || this.local), maybeNone(children || this.children))
  }

  grow(length: number): RangeSet<T> {
    return new RangeSet<T>(this.length + length, this.size, this.local, this.children)
  }

  // Collect all ranges in this set into the target array,
  // offsetting them by `offset`
  collect(target: Range<T>[], offset: number) {
    for (let range of this.local) target.push(range.move(offset))
    for (let child of this.children) {
      child.collect(target, offset)
      offset += child.length
    }
  }

  map(changes: ChangeSet): RangeSet<T> {
    if (changes.length == 0 || this == RangeSet.empty) return this
    return this.mapInner(changes, 0, 0, changes.mapPos(this.length, 1)).set
  }

  // Child boundaries are always mapped forward. This may cause ranges
  // at the start of a set to end up sticking out before its new
  // start, if they map backward. Such ranges are returned in
  // `escaped`.
  private mapInner(changes: ChangeSet,
                   oldStart: number, newStart: number,
                   newEnd: number): {set: RangeSet<T>, escaped: Range<T>[] | null} {
    let newLocal: Range<T>[] | null = null
    let escaped: Range<T>[] | null = null
    let newLength = newEnd - newStart, newSize = 0

    for (let i = 0; i < this.local.length; i++) {
      let range = this.local[i], mapped = range.map(changes, oldStart, newStart)
      let escape = mapped != null && (mapped.from < 0 || mapped.to > newLength)
      if (newLocal == null && (range != mapped || escape)) newLocal = this.local.slice(0, i)
      if (escape) (escaped || (escaped = [])).push(mapped!)
      else if (newLocal && mapped) newLocal.push(mapped)
    }

    let newChildren: RangeSet<T>[] | null = null
    for (let i = 0, oldPos = oldStart, newPos = newStart; i < this.children.length; i++) {
      let child = this.children[i], newChild = child
      let oldChildEnd = oldPos + child.length
      let newChildEnd = changes.mapPos(oldPos + child.length, 1)
      let touch = touchesChanges(oldPos, oldChildEnd, changes.changes)
      if (touch == Touched.Yes) {
        let inner = child.mapInner(changes, oldPos, newPos, newChildEnd)
        newChild = inner.set
        if (inner.escaped) for (let range of inner.escaped) {
          range = range.move(newPos - newStart)
          if (range.from < 0 || range.to > newLength)
            insertSorted(escaped || (escaped = []), range)
          else
            insertSorted(newLocal || (newLocal = this.local.slice()), range)
        }
      } else if (touch == Touched.Covered) {
        newChild = RangeSet.empty.grow(newChildEnd - newPos)
      }
      if (newChild != child) {
        if (newChildren == null) newChildren = this.children.slice(0, i)
        // If the node's content was completely deleted by mapping,
        // drop the node—which is complicated by the need to
        // distribute its length to another child when it's not the
        // last child
        if (newChild.size == 0 && (newChild.length == 0 || newChildren.length || i == this.children.length)) {
          if (newChild.length > 0 && i > 0) {
            let last = newChildren.length - 1, lastChild = newChildren[last]
            newChildren[last] = new RangeSet<T>(lastChild.length + newChild.length, lastChild.size, lastChild.local, lastChild.children)
          }
        } else {
          newChildren.push(newChild)
        }
      } else if (newChildren) {
        newChildren.push(newChild)
      }
      newSize += newChild.size
      oldPos = oldChildEnd
      newPos = newChildEnd
    }

    let set = newLength == this.length && newChildren == null && newLocal == null
      ? this
      : new RangeSet<T>(newLength, newSize + (newLocal || this.local).length,
                        newLocal || this.local, newChildren || this.children)
    return {set, escaped}
  }

  forEach(f: (from: number, to: number, value: T) => void) { this.forEachInner(f, 0) }

  private forEachInner(f: (from: number, to: number, value: T) => void, offset: number) {
    for (let range of this.local) f(range.from + offset, range.to + offset, range.value)
    for (let child of this.children) { child.forEachInner(f, offset); offset += child.length }
  }

  // Iterate over the ranges in the set that touch the area between
  // from and to, ordered by their start position and side
  iter(from: number = 0, to: number = this.length): {next: () => Range<T> | void} {
    const heap: (Range<T> | LocalSet<T>)[] = []
    addIterToHeap(heap, [new IteratedSet(0, this)], from)
    if (this.local.length) addToHeap(heap, new LocalSet(0, this.local))

    return {
      next(): Range<T> | void {
        for (;;) {
          if (heap.length == 0) return
          const next = takeFromHeap(heap) as LocalSet<T>
          const range = next.ranges[next.index++].move(next.offset)
          if (range.from > to) return
          // Put the rest of the set back onto the heap
          if (next.index < next.ranges.length) addToHeap(heap, next)
          else if (next.next) addIterToHeap(heap, next.next, 0)
          if (range.to >= from) return range
        }
      }
    }
  }

  compare(other: RangeSet<T>, textDiff: A<ChangedRange>, comparator: RangeComparator<T>, oldLen: number) {
    let oldPos = 0, newPos = 0
    for (let range of textDiff) {
      if (range.fromB > newPos && (this != other || oldPos != newPos))
        new RangeSetComparison<T>(this, oldPos, other, newPos, range.fromB, comparator).run()
      oldPos = range.toA
      newPos = range.toB
    }
    if (oldPos < this.length || newPos < other.length || textDiff.length == 0)
      new RangeSetComparison<T>(this, oldPos, other, newPos, newPos + (oldLen - oldPos), comparator).run()
  }

  static iterateSpans<T extends RangeValue>(sets: A<RangeSet<T>>, from: number, to: number, iterator: RangeIterator<T>) {
    let heap: Heapable[] = []
    let pos = from, posSide = -2e9

    for (let set of sets) if (set.size > 0) {
      addIterToHeap(heap, [new IteratedSet(0, set)], pos)
      if (set.local.length) addToHeap(heap, new LocalSet(0, set.local))
    }
    let active: T[] = []

    while (heap.length > 0) {
      let next = takeFromHeap(heap)
      if (next instanceof LocalSet) {
        let range = next.ranges[next.index], rFrom = range.from + next.offset, rTo = range.to + next.offset
        if (rFrom > to) break
        // Put the rest of the set back onto the heap
        if (++next.index < next.ranges.length) addToHeap(heap, next)
        else if (next.next) addIterToHeap(heap, next.next, pos)

        if ((rTo - pos || range.value.endSide - posSide) >= 0 && !iterator.ignore(rFrom, rTo, range.value)) {
          if (rFrom > pos) {
            iterator.span(pos, rFrom, active)
            pos = rFrom
            posSide = range.value.startSide
          }
          if (range.value.point) {
            iterator.point(pos, Math.min(rTo, to), range.value, rFrom < pos, rTo > to)
            pos = rTo
            if (rTo > to) break
            posSide = range.value.endSide
          } else if (rTo > pos) {
            active.push(range.value)
            addToHeap(heap, new Range(rFrom, rTo, range.value))
          }
        }
      } else { // A range that ends here
        let range = next as Range<T>
        if (range.to > to) break
        if (range.to > pos) {
          iterator.span(pos, range.to, active)
          pos = range.to
          posSide = range.value.endSide
        }
        active.splice(active.indexOf(range.value), 1)
      }
    }
    if (pos < to) iterator.span(pos, to, active)
  }

  static of<T extends RangeValue>(ranges: A<Range<T>> | Range<T>): RangeSet<T> {
    return RangeSet.empty.update(ranges instanceof Range ? [ranges] : ranges)
  }

  static empty = new RangeSet<any>(0, 0, none, none)
}

// Stack element for iterating over a range set
class IteratedSet<T extends RangeValue> {
  // Index == -1 means the set's locals have not been yielded yet.
  // Otherwise this is an index in the set's child array.
  index: number = 0
  constructor(public offset: number,
              public set: RangeSet<T>) {}
}

// Cursor into a node-local set of ranges
class LocalSet<T extends RangeValue> {
  public index: number = 0
  constructor(public offset: number,
              public ranges: A<Range<T>>,
              public next: IteratedSet<T>[] | null = null) {}

  // Used to make this conform to Heapable
  get heapPos(): number { return this.ranges[this.index].from + this.offset }
  get heapSide(): number { return this.ranges[this.index].value.startSide }
}

// Iterating over a range set is done using a stack that represents a
// position into the range set's tree. There's an IteratedSet for each
// active level, and iteration happens by calling this function to
// move the next node onto the stack (which may involve popping off
// nodes before it).
//
// Such a stack represenst the _structural_ part of the tree,
// iterating over tree nodes. The individual ranges of each top node
// must be accessed separately, after it has been moved onto the stack
// (the new node is always at the top, or, if the end of the set has
// been reached, the stack is empty).
//
// Nodes that fall entirely before `skipTo` are never added to the
// stack, allowing efficient skipping of parts of the tree.
function iterRangeSet<T extends RangeValue>(stack: IteratedSet<T>[], skipTo: number = 0) {
  for (;;) {
    if (stack.length == 0) break
    let top = stack[stack.length - 1]
    if (top.index == top.set.children.length) {
      stack.pop()
    } else {
      let next = top.set.children[top.index], start = top.offset
      top.index++
      top.offset += next.length
      if (top.offset >= skipTo) {
        stack.push(new IteratedSet(start, next))
        break
      }
    }
  }
}

// Iterating over the actual ranges in a set (or multiple sets) is
// done using a binary heap to efficiently get the ordering right. The
// heap may contain both LocalSet instances (iterating over the ranges
// in a set tree node) and actual Range objects. At any point, the one
// with the lowest position (and side) is taken off next.

function compareHeapable(a: Heapable, b: Heapable): number {
  return a.heapPos - b.heapPos || a.heapSide - b.heapSide
}

// Advance the iteration over a range set (in `stack`) and add the
// next node that has any local ranges to the heap as a `LocalSet`.
// Links the stack to the `LocalSet` (in `.next`) if this node also
// has child nodes, which will be used to schedule the next call to
// `addIterToHeap` when the end of that `LocalSet` is reached.
function addIterToHeap<T extends RangeValue>(heap: Heapable[], stack: IteratedSet<T>[], skipTo: number = 0) {
  for (;;) {
    iterRangeSet<T>(stack, skipTo)
    if (stack.length == 0) break
    let next = stack[stack.length - 1], local = next.set.local
    let leaf = next.set.children.length ? null : stack
    if (local.length) addToHeap(heap, new LocalSet<T>(next.offset, local, leaf))
    if (leaf) break
  }
}

// Classic binary heap implementation, using the conformance to
// `Heapable` of the elements to compare them with `compareHeapable`,
// keeping the element with the lowest position at its top.

function addToHeap(heap: Heapable[], elt: Heapable) {
  let index = heap.push(elt) - 1
  while (index > 0) {
    let parentIndex = index >> 1, parent = heap[parentIndex]
    if (compareHeapable(elt, parent) >= 0) break
    heap[index] = parent
    heap[parentIndex] = elt
    index = parentIndex
  }
}

function takeFromHeap<T extends Heapable>(heap: T[]): T {
  let elt = heap[0], replacement = heap.pop()!
  if (heap.length == 0) return elt
  heap[0] = replacement
  for (let index = 0;;) {
    let childIndex = (index << 1) + 1
    if (childIndex >= heap.length) break
    let child = heap[childIndex]
    if (childIndex + 1 < heap.length && compareHeapable(child, heap[childIndex + 1]) >= 0) {
      child = heap[childIndex + 1]
      childIndex++
    }
    if (compareHeapable(replacement, child) < 0) break
    heap[childIndex] = replacement
    heap[index] = child
    index = childIndex
  }
  return elt
}

function byPos(a: Range<RangeValue>, b: Range<RangeValue>): number {
  return a.from - b.from || a.value.startSide - b.value.startSide
}

function insertSorted(target: Range<RangeValue>[], range: Range<RangeValue>) {
  let i = target.length
  while (i > 0 && byPos(target[i - 1], range) >= 0) i--
  target.splice(i, 0, range)
}

function filterRanges<T extends RangeValue>(ranges: A<Range<T>>,
                                            filter: RangeFilter<T> | null,
                                            filterFrom: number, filterTo: number,
                                            offset: number): Range<T>[] | null {
  if (!filter) return null
  let copy: Range<T>[] | null = null
  for (let i = 0; i < ranges.length; i++) {
    let range = ranges[i], from = range.from + offset, to = range.to + offset
    if (filterFrom > to || filterTo < from || filter(from, to, range.value)) {
      if (copy != null) copy.push(range)
    } else {
      if (copy == null) copy = ranges.slice(0, i)
    }
  }
  return copy
}

function collapseSet<T extends RangeValue>(
  children: A<RangeSet<T>>, local: Range<T>[],
  add: A<Range<T>>, start: number, offset: number, length: number
): RangeSet<T> {
  let mustSort = local.length > 0 && add.length > 0, off = 0
  for (let child of children) {
    child.collect(local, -off)
    off += child.length
  }
  for (let added of add) local.push(added.move(-offset))
  if (mustSort) local.sort(byPos)

  return new RangeSet<T>(length, local.length, local, none)
}

function appendRanges<T extends RangeValue>(local: Range<T>[], children: RangeSet<T>[],
                                            ranges: A<Range<T>>, start: number,
                                            offset: number, length: number, pos: number, childSize: number) {
  // Group added ranges after the current children into new
  // children (will usually only happen when initially creating a
  // node or adding stuff to the top-level node)
  for (let i = start; i < ranges.length;) {
    let add: Range<T>[] = []
    let end = Math.min(i + childSize, ranges.length)
    let endPos = end == ranges.length ? offset + length : ranges[end].from
    for (; i < end; i++) {
      let range = ranges[i]
      if (range.to > endPos) insertSorted(local, range.move(-offset))
      else add.push(range)
    }
    // Move locals that fit in this new child from `local` to `add`
    for (let i = 0; i < local.length; i++) {
      let range = local[i]
      if (range.from >= pos && range.to <= endPos) {
        local.splice(i--, 1)
        insertSorted(add, range.move(offset))
      }
    }
    if (add.length) {
      if (add.length == ranges.length)
        children.push(new RangeSet(endPos - pos, add.length, add.map(r => r.move(-pos)), none))
      else
        children.push(RangeSet.empty.updateInner(add, null, 0, 0, pos, endPos - pos))
      pos = endPos
    }
  }
}

// FIXME try to clean this up
function rebalanceChildren<T extends RangeValue>(local: Range<T>[], children: RangeSet<T>[], childSize: number) {
  for (let i = 0, off = 0; i < children.length;) {
    let child = children[i], next
    if (child.size == 0 && (i > 0 || children.length == 1)) {
      // Drop empty node
      children.splice(i--, 1)
      if (i >= 0) children[i] = children[i].grow(child.length)
    } else if (child.size > (childSize << 1) && child.local.length < (child.length >> 1)) {
      // Unwrap an overly big node
      for (let range of child.local) insertSorted(local, range.move(off))
      children.splice(i, 1, ...child.children)
    } else if (child.children.length == 0 && i < children.length - 1 &&
               (next = children[i + 1]).size + child.size <= BASE_NODE_SIZE &&
               next.children.length == 0) {
      // Join two small leaf nodes
      children.splice(i, 2, new RangeSet<T>(child.length + next.length,
                                            child.size + next.size,
                                            child.local.concat(next.local.map(d => d.move(child.length))),
                                            none))
    } else {
      // Join a number of nodes into a wrapper node
      let joinTo = i + 1, size = child.size, length = child.length
      if (child.size < (childSize >> 1)) {
        for (; joinTo < children.length; joinTo++) {
          let next = children[joinTo], totalSize = size + next.size
          if (totalSize > childSize) break
          size = totalSize
          length += next.length
        }
      }
      if (joinTo > i + 1) {
        let joined = new RangeSet<T>(length, size, none, children.slice(i, joinTo))
        let joinedLocals = []
        for (let j = 0; j < local.length; j++) {
          let range = local[j]
          if (range.from >= off && range.to <= off + length) {
            local.splice(j--, 1)
            joinedLocals.push(range.move(-off))
          }
        }
        if (joinedLocals.length) joined = joined.update(joinedLocals.sort(byPos))
        children.splice(i, joinTo - i, joined)
        i++
        off += length
      } else {
        i++
        off += child.length
      }
    }
  }
}

const SIDE_A = 1, SIDE_B = 2

class ComparisonSide<T extends RangeValue> {
  heap: LocalSet<T>[] = []
  active: T[] = []
  activeTo: number[] = []
  points: T[] = []
  tip: LocalSet<T> | null = null
  point: T | null = null
  pointTo: number = -1

  constructor(readonly stack: IteratedSet<T>[]) {}

  forward(start: number, next: IteratedSet<T>): boolean {
    let newTip = false
    if (next.set.local.length) {
      let local = new LocalSet(next.offset, next.set.local)
      addToHeap(this.heap, local)
      if (!next.set.children.length) {
        this.tip = local
        newTip = true
      }
    }
    iterRangeSet(this.stack, start)
    return newTip
  }

  findActive(to: number, value: T): number {
    for (let i = 0; i < this.active.length; i++)
      if (this.activeTo[i] == to && (this.active[i] == value || this.active[i].eq(value)))
        return i
    return -1
  }

  clearPoint() {
    this.pointTo = -1
    this.point = null
  }

  get nextPos() {
    return this.pointTo > -1 ? this.pointTo : this.heap.length ? this.heap[0].heapPos : 2e9
  }

  get nextSide() {
    return this.pointTo > -1 ? this.point!.endSide : this.heap.length ? this.heap[0].heapSide : 2e9
  }
}

// Manage the synchronous iteration over a part of two range sets,
// skipping identical nodes and ranges and calling callbacks on a
// comparator object when differences are found.
class RangeSetComparison<T extends RangeValue> {
  a: ComparisonSide<T>
  b: ComparisonSide<T>
  pos: number
  end: number

  constructor(a: RangeSet<T>, startA: number,
              b: RangeSet<T>, startB: number, endB: number,
              private comparator: RangeComparator<T>) {
    this.a = new ComparisonSide<T>([new IteratedSet<T>(startB - startA, a)])
    this.b = new ComparisonSide<T>([new IteratedSet<T>(0, b)])
    this.pos = startB
    this.end = endB
    this.forwardIter(SIDE_A | SIDE_B)
  }

  // Move the iteration over the tree structure forward until all of
  // the sides included in `side` (bitmask of `SIDE_A` and/or
  // `SIDE_B`) have added new nodes to their heap, or there is nothing
  // further to iterate over. This is basically used to ensure the
  // heaps are stocked with nodes from the stacks that track the
  // iteration.
  forwardIter(side: number) {
    for (; side > 0;) {
      let nextA = this.a.stack.length ? this.a.stack[this.a.stack.length - 1] : null
      let nextB = this.b.stack.length ? this.b.stack[this.b.stack.length - 1] : null
      if (!nextA && (side & SIDE_A)) {
        // If there's no next node for A, we're done there
        side &= ~SIDE_A
      } else if (!nextB && (side & SIDE_B)) {
        // No next node for B
        side &= ~SIDE_B
      } else if (nextA && nextB && nextA.offset == nextB.offset && nextA.set == nextB.set) {
        // Both next nodes are the same—skip them
        iterRangeSet<T>(this.a.stack, this.pos)
        iterRangeSet<T>(this.b.stack, this.pos)
      } else if (nextA && (!nextB || (nextA.offset < nextB.offset ||
                                      nextA.offset == nextB.offset && (this.a.stack.length == 1 ||
                                                                       nextA.set.length >= nextB.set.length)))) {
        // If there no next B, or it comes after the next A, or it
        // sits at the same position and is smaller, move A forward.
        if (this.a.forward(this.pos, nextA)) side &= ~SIDE_A
      } else {
        // Otherwise move B forward
        if (this.b.forward(this.pos, nextB!)) side &= ~SIDE_B
      }
    }
  }

  // Driver of the comparison process. On each iteration, call
  // `advance` with the side whose next event (start of end of a
  // range) comes first, until we run out of events.
  run() {
    for (;;) {
      let nextA = this.a.nextPos, nextB = this.b.nextPos
      if (nextA == 2e9 && nextB == 2e9) break
      let diff = nextA - nextB || this.a.nextSide - this.a.nextSide
      if (diff < 0) this.advance(this.a, this.b)
      else this.advance(this.b, this.a)
    }
  }

  advance(side: ComparisonSide<T>, other: ComparisonSide<T>) {
    if (side.pointTo > -1) {
      // The next thing that's happening is the end of this.point
      let end = Math.min(this.end, side.pointTo)
      if (!other.point || !side.point!.eq(other.point))
        this.comparator.comparePoint(this.pos, end, side.point!, other.point)
      this.pos = end
      if (end == this.end ||
          other.pointTo == end && other.point!.endSide == side.point!.endSide) other.clearPoint()
      side.clearPoint()
      return
    }

    let next = takeFromHeap(side.heap)!
    if (next instanceof LocalSet) {
      // If this is a local set, we're seeing a new range being
      // opened.
      let range = next.ranges[next.index++]
      // The actual positions are offset relative to the node
      let from = range.from + next.offset, to = range.to + next.offset
      if (from > this.end) {
        // If we found a range past the end, we're done
        side.heap.length = 0
        return
      } else if (next.index < next.ranges.length) {
        // If there's more ranges in this node, re-add it to the heap
        addToHeap(side.heap, next)
      } else {
        // Otherwise, move the iterator forward (making sure this side is advanced)
        this.forwardIter(side == this.a ? SIDE_A : SIDE_B)
      }

      // Ignore ranges that fall entirely in a point on the other side
      if (to < other.pointTo || to == other.pointTo && range.value.startSide < other.point!.endSide) return
      // Otherwise, if the other side isn't a point, advance
      if (other.pointTo < 0) this.advancePos(from)
      if (range.value.point) {
        side.point = range.value
        side.pointTo = to
      } else {
        to = Math.min(to, this.end)
        // Add this to the set of active ranges
        let found = other.findActive(to, range.value)
        if (found > -1) {
          remove(other.active, found)
          remove(other.activeTo, found)
        } else {
          side.active.push(range.value)
          side.activeTo.push(to)
          addToHeap(side.heap, new Range(this.pos, to, range.value))
        }
      }
    } else {
      // This is the end of a range, remove it from the active set if it's in there.
      let range = next as Range<T>
      if (other.pointTo < 0) this.advancePos(range.to)
      let found = side.findActive(range.to, range.value)
      if (found > -1) { remove(side.active, found); remove(side.activeTo, found) }
    }
  }

  advancePos(pos: number) {
    if (pos > this.end) pos = this.end
    if (pos <= this.pos) return
    if (!sameSet(this.a.active, this.b.active))
      this.comparator.compareRange(this.pos, pos, this.a.active, this.b.active)
    this.pos = pos
  }
}

function sameSet<T extends RangeValue>(a: T[], b: T[]) {
  if (a.length != b.length) return false
  outer: for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++)
      if (a[i].eq(b[j])) continue outer
    return false
  }
  return true
}

function remove<T>(array: T[], index: number) {
  let last = array.pop()!
  if (index != array.length) array[index] = last
}

const enum Touched {Yes, No, Covered}

function touchesChanges(from: number, to: number, changes: A<Change>): Touched {
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
