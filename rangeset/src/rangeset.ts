import {Change} from "../../state/src/state"
import {ChangedRange} from "../../doc/src/diff"

type A<T> = ReadonlyArray<T>

export interface RangeValue {
  map(changes: A<Change>, from: number, to: number): Range<any> | null
  bias: number
  collapsed?: boolean
}

export interface RangeComparator<T extends RangeValue> {
  compareRange(from: number, to: number, activeA: T[], activeB: T[]): void
  ignoreRange(value: T): boolean
  comparePoints(pos: number, pointsA: T[], pointsB: T[]): void
  ignorePoint(value: T): boolean
}

export interface RangeIterator<T extends RangeValue> {
  advance(pos: number, active: A<T>): void
  advanceCollapsed(pos: number): void
  point(value: T): void
  ignoreRange(value: T): boolean
  ignorePoint(value: T): boolean
}

interface Heapable { heapPos: number; value: RangeValue }

export class Range<T extends RangeValue> {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly value: T
  ) {}

  /** @internal */
  map(changes: A<Change>, oldOffset: number, newOffset: number): Range<T> | null {
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
}

const noRanges: A<Range<any>> = []
const noChildren: A<RangeSet<any>> = []

const BASE_NODE_SIZE_SHIFT = 5, BASE_NODE_SIZE = 1 << BASE_NODE_SIZE_SHIFT

export type RangeFilter<T> = (from: number, to: number, value: T) => boolean

// FIXME look into generalizing this to a generic mappable
// position-data container

export class RangeSet<T extends RangeValue> {
  /** @internal */
  constructor(
    /** @internal The text length covered by this set */
    public length: number,
    /** The number of ranges in the set */
    public size: number,
    /** @internal The locally stored ranges—which are all of them
     * for leaf nodes, and the ones that don't fit in child sets for
     * non-leaves. Sorted by start position, then end position, then startAssoc. */
    public local: A<Range<T>>,
    /** @internal The child sets, in position order */
    public children: A<RangeSet<T>>
  ) {}

  update(added: A<Range<T>> = noRanges,
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
        newChild = newChild.updateInner(localRanges || noRanges, filter, filterFrom, filterTo,
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

    // Compute final size and length
    size += (local || this.local).length + added.length - decI

    // This is a small node—turn it into a flat leaf
    if (size <= BASE_NODE_SIZE)
      return collapseSet(children || this.children, local || this.local.slice(),
                         added, decI, offset, length)


    // FIXME going from leaf to non-leaf is currently a mess—will
    // leave all the locals alongside a newly created child

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

    return new RangeSet<T>(length, size, local || this.local, children || this.children)
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

  map(changes: A<Change>): RangeSet<T> {
    if (changes.length == 0 || this == RangeSet.empty) return this
    return this.mapInner(changes, 0, 0, mapPos(this.length, changes, 1)).set
  }

  private mapInner(changes: A<Change>,
                   oldStart: number, newStart: number,
                   newEnd: number): {set: RangeSet<T>, escaped: Range<T>[] | null} {
    let newLocal: Range<T>[] | null = null
    let escaped: Range<T>[] | null = null
    let newLength = newEnd - newStart, newSize = 0

    for (let i = 0; i < this.local.length; i++) {
      let range = this.local[i], mapped = range.map(changes, oldStart, newStart)
      let escape = mapped != null && (mapped.from < 0 || mapped.to > newLength)
      if (newLocal == null && (range != mapped || escaped)) newLocal = this.local.slice(0, i)
      if (escape) (escaped || (escaped = [])).push(mapped!)
      else if (newLocal && mapped) newLocal.push(mapped)
    }

    let newChildren: RangeSet<T>[] | null = null
    for (let i = 0, oldPos = oldStart, newPos = newStart; i < this.children.length; i++) {
      let child = this.children[i], newChild = child
      let oldChildEnd = oldPos + child.length
      let newChildEnd = mapPos(oldPos + child.length, changes, 1)
      // FIXME immediately collapse children entirely covered by a change
      if (touchesChange(oldPos, oldChildEnd, changes)) {
        let inner = child.mapInner(changes, oldPos, newPos, newChildEnd)
        newChild = inner.set
        if (inner.escaped) for (let range of inner.escaped) {
          range = range.move(newPos - newStart)
          if (range.from < 0 || range.to > newLength) {
            ;(escaped || (escaped = [])).push(range)
          } else {
            if (newLocal == null) newLocal = this.local.slice()
            insertSorted(newLocal, range)
          }
        }
      } else if (newChildEnd - newPos != oldChildEnd - oldPos) {
        newChild = new RangeSet<T>(newChildEnd - newPos, child.size, child.local, child.children)
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

  compare(other: RangeSet<T>, textDiff: A<ChangedRange>, comparator: RangeComparator<T>) {
    let oldPos = 0, newPos = 0
    for (let range of textDiff) {
      if (range.fromB > newPos && (this != other || oldPos != newPos))
        new RangeSetComparison<T>(this, oldPos, other, newPos, range.fromB, comparator).run()
      oldPos = range.toA
      newPos = range.toB
    }
    if (oldPos < this.length || newPos < other.length)
      new RangeSetComparison<T>(this, oldPos, other, newPos, Math.max(this.length - oldPos + newPos, other.length),
                                comparator).run()
  }

  static iterateSpans<T extends RangeValue>(sets: A<RangeSet<T>>, from: number, to: number, iterator: RangeIterator<T>) {
    let heap: Heapable[] = []

    for (let set of sets) if (set.size > 0) {
      addIterToHeap(heap, [new IteratedSet(0, set)], from)
      if (set.local.length) addToHeap(heap, new LocalSet(0, set.local))
    }
    let active: T[] = []

    while (heap.length > 0) {
      let next = takeFromHeap(heap)
      if (next instanceof LocalSet) {
        let range = next.ranges[next.index]
        if (range.from + next.offset > to) break

        if (range.to + next.offset >= from) {
          if (range.from < range.to && !iterator.ignoreRange(range.value)) {
            range = range.move(next.offset)
            
            iterator.advance(range.from, active)
            let collapsed = range.value.collapsed
            if (collapsed) {
              if (!iterator.ignorePoint(range.value)) iterator.point(range.value)
              from = range.to
              iterator.advanceCollapsed(Math.min(from, to))
            } else {
              active.push(range.value)
              addToHeap(heap, range)
            }
          } else if (range.from == range.to && !iterator.ignorePoint(range.value)) {
            iterator.advance(range.from, active)
            iterator.point(range.value)
          }
        }
        // Put the rest of the set back onto the heap
        if (++next.index < next.ranges.length) addToHeap(heap, next)
        else if (next.next) addIterToHeap(heap, next.next, from)
      } else { // It is a range that ends here
        let range = next as Range<T>
          if (range.to >= to) break
        iterator.advance(range.to, active)
        active.splice(active.indexOf(range.value), 1)
      }
    }
    iterator.advance(to, active)
  }

  static of<T extends RangeValue>(ranges: A<Range<T>> | Range<T>): RangeSet<T> {
    let set = RangeSet.empty
    if (ranges instanceof Range) set = set.update([ranges])
    else if (ranges.length) set = set.update(ranges)
    return set
  }

  static empty = new RangeSet<any>(0, 0, noRanges, noChildren);
}

// Stack element for iterating over a range set
class IteratedSet<T extends RangeValue> {
  // Index == -1 means the set's locals have not been yielded yet.
  // Otherwise this is an index in the set's child array.
  index: number = 0;
  constructor(public offset: number,
              public set: RangeSet<T>) {}
}

// Cursor into a node-local set of ranges
class LocalSet<T extends RangeValue> {
  public index: number = 0;
  constructor(public offset: number,
              public ranges: A<Range<T>>,
              public next: IteratedSet<T>[] | null = null) {}

  // Used to make this conform to Heapable
  get heapPos(): number { return this.ranges[this.index].from + this.offset }
  get value(): T { return this.ranges[this.index].value }
}

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
function compareHeapable(a: Heapable, b: Heapable): number {
  return a.heapPos - b.heapPos || a.value.bias - b.value.bias
}

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

function takeFromHeap(heap: Heapable[]): Heapable {
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
  return a.from - b.from || a.value.bias - b.value.bias
}

function insertSorted(target: Range<RangeValue>[], deco: Range<RangeValue>) {
  let i = target.length
  while (i > 0 && byPos(target[i - 1], deco) >= 0) i--
  target.splice(i, 0, deco)
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

function touchesChange(from: number, to: number, changes: A<Change>): boolean {
  for (let change of changes) {
    if (change.to >= from && change.from <= to) return true
    let diff = change.text.length - (change.to - change.from)
    if (from > change.from) from += diff
    if (to > change.to) to += diff
  }
  return false
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

  return new RangeSet<T>(length, local.length, local, noChildren)
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
      let deco = ranges[i]
      if (deco.to > endPos) insertSorted(local, deco.move(-offset))
      else add.push(deco)
    }
    if (add.length) {
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
                                            noChildren))
      off += child.length + next.length
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
        let joined = new RangeSet<T>(length, size, noRanges, children.slice(i, joinTo))
        let joinedLocals = []
        for (let j = 0; j < local.length; j++) {
          let range = local[j]
          if (range.from >= off && range.to <= off + length) {
            local.splice(j--, 1)
            if (local.length == 0) local = noRanges as Range<T>[]
            joinedLocals.push(range.move(-off))
          }
        }
        if (joinedLocals.length) joined = joined.update(joinedLocals.sort(byPos))
        children.splice(i, joinTo - i, joined)
        i = joinTo
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
  heap: LocalSet<T>[] = [];
  active: T[] = [];
  points: T[] = [];
  tip: LocalSet<T> | null = null;
  collapsedTo: number = -1;

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
}

class RangeSetComparison<T extends RangeValue> {
  a: ComparisonSide<T>;
  b: ComparisonSide<T>;
  pos: number;
  end: number;

  constructor(a: RangeSet<T>, startA: number,
              b: RangeSet<T>, startB: number, endB: number,
              private comparator: RangeComparator<T>) {
    this.a = new ComparisonSide<T>([new IteratedSet<T>(startB - startA, a)])
    this.b = new ComparisonSide<T>([new IteratedSet<T>(0, b)])
    this.pos = startB
    this.end = endB
    this.forwardIter(SIDE_A | SIDE_B)
  }

  forwardIter(side: number) {
    for (; side > 0;) {
      let nextA = this.a.stack.length ? this.a.stack[this.a.stack.length - 1] : null
      let nextB = this.b.stack.length ? this.b.stack[this.b.stack.length - 1] : null
      if (nextA && nextB && nextA.offset == nextB.offset && nextA.set == nextB.set) {
        iterRangeSet<T>(this.a.stack, this.pos)
        iterRangeSet<T>(this.b.stack, this.pos)
      } else if (nextA && (!nextB || (nextA.offset < nextB.offset ||
                                      nextA.offset == nextB.offset && (this.a.stack.length == 1 ||
                                                                       nextA.set.length >= nextB.set.length)))) {
        if (this.a.forward(this.pos, nextA)) side = side & ~SIDE_A
      } else if (nextB) {
        if (this.b.forward(this.pos, nextB)) side = side & ~SIDE_B
      } else {
        break
      }
    }
  }

  run() {
    let heapA = this.a.heap, heapB = this.b.heap
    for (;;) {
      if (heapA.length && (!heapB.length || compareHeapable(heapA[0], heapB[0]) < 0)) {
        this.advance(this.a)
      } else if (heapB.length) {
        this.advance(this.b)
      } else {
        this.comparator.comparePoints(this.pos, this.a.points, this.b.points)
        break
      }
    }
  }

  advancePos(pos: number) {
    if (pos > this.end) pos = this.end
    if (pos <= this.pos) return
    if (this.a.points.length || this.b.points.length) {
      this.comparator.comparePoints(this.pos, this.a.points, this.b.points)
      this.a.points.length = this.b.points.length = 0
    }
    this.comparator.compareRange(this.pos, pos, this.a.active, this.b.active)
    this.pos = pos
  }

  advance(side: ComparisonSide<T>) {
    let next = takeFromHeap(side.heap)!
    if (next instanceof LocalSet) {
      let range = next.ranges[next.index++]
      if (range.from + next.offset > this.end) {
        side.heap.length = 0
        this.pos = this.end
        return
      }
      // FIXME handle line decoration?
      if (range.from < range.to && range.to + next.offset > this.pos && !this.comparator.ignoreRange(range.value)) {
        this.advancePos(range.from + next.offset)
        range = range.move(next.offset)
        let collapsed = range.value.collapsed
        if (collapsed) {
          if (!this.comparator.ignorePoint(range.value)) side.points.push(range.value)
          side.collapsedTo = Math.max(side.collapsedTo, range.to)
          // Skip regions that are collapsed on both sides
          let collapsedTo = Math.min(this.a.collapsedTo, this.b.collapsedTo)
          if (collapsedTo > this.pos) this.pos = collapsedTo
        }
        side.active.push(range.value)
        addToHeap(side.heap, range)
      } else if (range.from == range.to && !this.comparator.ignorePoint(range.value)) {
        this.advancePos(range.from)
        side.points.push(range.value)
      }
      if (next.index < next.ranges.length) addToHeap(side.heap, next)
      else if (next == this.a.tip) this.forwardIter(SIDE_A)
      else if (next == this.b.tip) this.forwardIter(SIDE_B)
    } else {
      let range = next as Range<T>
      this.advancePos(range.to)
      remove(side.active, range.value)
    }
  }
}

function remove<T>(array: T[], elt: T) {
  let found = array.indexOf(elt)
  let last = array.pop()!
  if (found != array.length) array[found] = last
}

// FIXME use a mapping abstraction defined in the state module
export function mapPos(pos: number, changes: A<Change>, assoc: number, track: boolean = false) {
  for (let change of changes) {
    if (track && change.from < pos && change.to > pos) return -1
    pos = change.mapPos(pos, assoc)
  }
  return pos
}
