import {Range, RangeSet, RangeValue, RangeComparator, RangeIterator} from "../src/rangeset"
import {Change, ChangeSet, Mapping} from "../../state/src"
const ist = require("ist")

class Value implements RangeValue {
  bias: number
  biasEnd: number
  collapsed: boolean
  name: string | null
  pos: number | null
  constructor(spec: any = {}) {
    this.bias = spec.bias || 1
    this.biasEnd = spec.biasEnd || -1
    this.collapsed = !!spec.collapsed
    this.name = spec.name || null
    this.pos = spec.pos == null ? null : spec.pos
  }
  map(mapping: Mapping, from: number, to: number): Range<Value> | null {
    if (from == to) {
      let pos = mapping.mapPos(from, this.bias, true)
      return pos < 0 ? null : new Range(pos, pos, this)
    } else {
      let newFrom = mapping.mapPos(from, this.bias), newTo = mapping.mapPos(to, this.biasEnd)
      return newFrom >= newTo ? null : new Range(newFrom, newTo, this)
    }
  }
  static names(v: ReadonlyArray<Value>): string {
    let result = ""
    for (let val of v) if (val.name || val.collapsed) result += (result ? "/" : "") + (val.name || "COLLAPSED")
    return result
  }
}

function depth(set: RangeSet<Value>): number {
  return 1 + Math.max(0, ...set.children.map(depth))
}
function maxSize(set: RangeSet<Value>): number {
  return Math.max(set.local.length, ...set.children.map(maxSize))
}
function size(set: RangeSet<Value>): number {
  return set.children.reduce((a, b) => a + size(b), set.local.length)
}
function avgSize(set: RangeSet<Value>): number {
  let total = 0, count = 0
  function scan(set: RangeSet<Value>) {
    total += set.local.length + set.children.length
    count++
    set.children.forEach(scan)
  }
  scan(set)
  return total / count
}
function checkSet(set: RangeSet<Value>, offset: number = 0) {
  ist(set.length, 0, ">=")
  ist(size(set), set.size)
  let off = 0
  for (let i = 0; i < set.children.length; i++) {
    let child = set.children[i]
    checkSet(child, offset + off)
    off += child.length
  }
  ist(off, set.length, "<=")
  for (let i = 0; i < set.local.length; i++) {
    let range = set.local[i]
    if (range.value.pos != null) ist(offset + range.from, range.value.pos)
    ist(range.to, range.from, ">=")
    ist(range.from, 0, ">=")
    ist(range.to, set.length, "<=")
  }
}

function mk(from: number, to?: any, spec?: any): Range<Value> {
  if (typeof to != "number") { spec = to; to = from }
  if (typeof spec == "string") spec = {name: spec}
  return new Range(from, to, new Value(spec))
}
function mkSet(ranges: Range<Value>[]) { return RangeSet.of<Value>(ranges) }

let smallRanges: Range<Value>[] = []
for (let i = 0; i < 5000; i++)
  smallRanges.push(mk(i, i + 1 + (i % 4), {pos: i}))
let _set0: RangeSet<Value> | null = null
function set0() { return _set0 || (_set0 = mkSet(smallRanges)) }

describe("RangeSet", () => {
  it("creates a balanced tree", () => {
    let set = mkSet(smallRanges.concat([mk(1000, 4000, {pos: 1000}), mk(2000, 3000, {pos: 2000})]))
    ist(set.size, 5002)
    ist(size(set), 5002)
    ist(depth(set), 4, "<")
    ist(maxSize(set), 64, "<=")
    ist(avgSize(set), 24, ">")
    checkSet(set)
  })

  describe("update", () => {
    it("can add ranges to an existing set", () => {
      let set = set0().update([mk(2000, {pos: 2000}), mk(2008, 2200, {pos: 2008})])
      ist(set.size, 5002)
      checkSet(set)
      ist(set.children[0], set0().children[0])
      ist(set.children[set.children.length - 1], set0().children[set0().children.length - 1])
    })

    it("can add a large amount of ranges", () => {
      let set0 = mkSet([mk(0, {pos: 0}), mk(100, {pos: 100}), mk(2, 4000, {pos: 2}), mk(10000, {pos: 10000})])
      let set = set0.update(smallRanges)
      ist(set.size, 5004)
      checkSet(set)
    })

    it("can filter ranges", () => {
      let set = set0().update([], from => from >= 2500)
      ist(set.size, 2500)
      checkSet(set)
      ist(set.children[set.children.length - 1], set0().children[set0().children.length - 1])
    })

    it("can filter all over", () => {
      let set = set0().update([], from => (from % 200) >= 100)
      ist(set.size, 2500)
      checkSet(set)
    })

    it("can add and remove in one go", () => {
      let set = set0().update([mk(25, 30, {pos: 25})], from => from % 1000 > 0)
      ist(set.size, 4996)
      checkSet(set)
    })

    it("collapses the tree when removing almost all ranges", () => {
      let set = set0().update([], from => from == 500 || from == 501)
      ist(set.size, 2)
      ist(depth(set), 1)
    })

    it("doesn't call filter on ranges outside the filter range", () => {
      let called = 0
      set0().update([], () => (called++, true), 2000, 2005)
      ist(called, 10, "<")
    })

    it("reuses unchanged nodes", () => {
      ist(set0().update([], () => true), set0())
    })

    it("creates a sorted set", () => {
      let set = mkSet([mk(2, 4, "a"), mk(8, 11, "a")])
        .update([mk(3, 9, "b"), mk(16, 17, "b")])
      ist(set.local.map(d => d.from).join(","), "2,3,8,16")
    })

    it("moves locals down when splitting a leaf", () => {
      let set = mkSet([mk(2), mk(3), mk(4), mk(5)])
        .update(new Array(200).fill(undefined).map((_, i) => mk(i, i + 1)))
      ist(set.local.length, 0)
    })

    it("can add 33 pathological ranges", () => {
      RangeSet.empty.update(new Array(33).fill(undefined).map((_, i) => mk(0, 1 + i)))
    })
  })

  describe("map", () => {
    function test(positions: Range<Value>[], changes: [number, number, number][], newPositions: (number | [number, number])[]) {
      let set = mkSet(positions)
      let mapped = set.map(new ChangeSet(changes.map(([from, to, len]) => new Change(from, to, ["x".repeat(len)]))))
      let out: Range<Value>[] = []
      mapped.collect(out, 0)
      ist(JSON.stringify(out.map(d => d.from + "-" + d.to)),
          JSON.stringify(newPositions.map(p => Array.isArray(p) ? {from: p[0], to: p[1]} : {from: p, to: p}).map(r => r.from + "-" + r.to)))
    }

    it("can map through changes", () =>
       test([mk(1), mk(4), mk(10)], [[0, 0, 1], [2, 3, 0], [8, 8, 20]], [2, 4, 30]))

    it("takes inclusivity into account", () =>
       test([mk(1, 2, {bias: -1, biasEnd: 1})], [[1, 1, 2], [4, 4, 2]], [[1, 6]]))

    it("uses side to determine mapping of points", () =>
       test([mk(1, 1, {bias: 1}), mk(1, 1, {bias: -1})], [[1, 1, 2]], [1, 3]))

    it("defaults to exclusive on both sides", () =>
       test([mk(1, 2)], [[1, 1, 2], [4, 4, 2]], [[3, 4]]))

    it("drops collapsed ranges", () =>
       test([mk(1, 2)], [[1, 2, 0], [1, 1, 1]], []))

    it("drops ranges in deleted regions", () =>
       test([mk(1, 2), mk(3)], [[0, 4, 0]], []))

    it("shrinks range ranges", () =>
       test([mk(2, 4), mk(2, 8), mk(6, 8)], [[3, 7, 0]], [[2, 3], [2, 4], [3, 4]]))

    it("leaves point ranges on change boundaries", () =>
       test([mk(2), mk(4)], [[2, 4, 6]], [2, 8]))

    it("adjusts the set tree shape", () => {
      let child0Size = set0().children[0].length, child1Size = set0().children[1].length
      let set = set0().map(new ChangeSet([new Change(0, 0, ["hi"]), new Change(child0Size + 3, child0Size + 5, [""])]))
      ist(set.size, set0().size, "<=")
      ist(set.size, set0().size - 2, ">")
      ist(set.children[0].length, child0Size + 2)
      ist(set.children[1].length, child1Size - 2)
      ist(set.children[2].length, set0().children[2].length)
    })

    it("allows ranges to escape their parent node", () => {
      let ranges = []
      for (let i = 0; i < 100; i++)
        ranges.push(mk(i, i + 1, {bias: -1, biasEnd: 1}))
      let set0 = mkSet(ranges), nodeBoundary = set0.children[0].length
      let set = set0.map(new ChangeSet([new Change(nodeBoundary, nodeBoundary, ["hello"])]))
      ist(set.size, set0.size)
      checkSet(set)
    })

    it("removes collapsed tree nodes", () => {
      let set = set0().map(new ChangeSet([new Change(0, 6000, [""])]))
      ist(set.size, 0)
      ist(depth(set), 1)
    })
  })

  describe("forEach", () => {
    it("calls the callback with the proper positions", () => {
      let called = 0
      set0().forEach((from, to, value) => {
        ++called
        ist(from, value.pos)
        ist(to, value.pos! + 1 + value.pos! % 4)
      })
      ist(called, set0().size)
    })
  })

  class Comparator implements RangeComparator<Value> {
    ranges: number[] = []
    compareRange(from: number, to: number, activeA: Value[], activeB: Value[]) {
      if (Value.names(activeA) != Value.names(activeB)) this.addRange(from, to)
    }
    comparePoints(pos: number, pointsA: Value[], pointsB: Value[]) {
      if (Value.names(pointsA) != Value.names(pointsB)) this.addRange(pos, pos)
    }
    ignoreRange(value: Value) { return !value.name && !value.collapsed }
    ignorePoint(value: Value) { return !value.name }
    addRange(from: number, to: number) {
      if (this.ranges.length && this.ranges[this.ranges.length - 1] == from) this.ranges[this.ranges.length - 1] = to
      else this.ranges.push(from, to)
    }
  }

  describe("compare", () => {
    function test(ranges: RangeSet<Value> | Range<Value>[], update: any, changes: number[]) {
      let set = Array.isArray(ranges) ? mkSet(ranges) : ranges
      let newSet = set
      let docRanges = []
      if (update.changes) {
        let changes = new ChangeSet(update.changes.map(([from, to, len]: [number, number, number]) => new Change(from, to, ["x".repeat(len)])))
        newSet = newSet.map(changes)
        for (let i = 0, off = 0; i < changes.length; i++) {
          let {from, to, length} = changes.changes[i]
          docRanges.push({fromA: from + off, toA: to + off, fromB: from, toB: from + length})
          off += (to - from) - length
        }
      }
      if (update.add || update.filter)
        newSet = newSet.update(update.add || [], update.filter)
      if (update.prepare) update.prepare(newSet)
      let comp = new Comparator
      set.compare(newSet, docRanges, comp)
      ist(JSON.stringify(comp.ranges), JSON.stringify(changes))
    }

    it("notices added ranges", () =>
       test([mk(2, 4, "a"), mk(8, 11, "a")], {
         add: [mk(3, 9, "b"), mk(106, 107, "b")]
       }, [3, 9, 106, 107]))

    it("notices deleted ranges", () =>
       test([mk(4, 6, "a"), mk(5, 7, "b"), mk(6, 8, "c"), mk(20, 30, "d")], {
         filter: (from: number) => from != 5 && from != 20
       }, [5, 7, 20, 30]))

    it("recognizes identical ranges", () =>
       test([mk(0, 50, "a")], {
         add: [mk(10, 40, "a")],
         filter: () => false
       }, [0, 10, 40, 50]))

    it("skips changes", () =>
       test([mk(0, 20, "a")], {
         changes: [[5, 15, 20]],
         filter: () => false
       }, [0, 5, 25, 30]))

    it("ignores identical sub-nodes", () => {
      let ranges = []
      for (let i = 0; i < 1000; i += 2) ranges.push(mk(i, i + 1, "a"))
      test(ranges, {
        changes: [[900, 1000, 0]],
        add: [mk(850, 860, "b")],
        prepare: (set: RangeSet<Value>) => Object.defineProperty(set.children[0], "local", {get() { throw new Error("NO TOUCH") }})
      }, [850, 860])
    })

    it("ignores collapsed sub-nodes", () => {
      let ranges = [mk(3, 997, {collapsed: true})]
      for (let i = 0; i < 1000; i += 2) ranges.push(mk(i, i + 1, "a"))
      let set = mkSet(ranges)
      test(set, {
        add: [mk(set.children[0].length + 1, set.children[0].length + 2, "b")],
        prepare: (set: RangeSet<Value>) => Object.defineProperty(set.children[2], "local", {get() { throw new Error("NO TOUCH") }})
      }, [])
    })

    it("ignores changes in collapsed ranges", () => {
      let ranges = [mk(3, 997, {collapsed: true})]
      for (let i = 0; i < 1000; i += 2) ranges.push(mk(i, i + 1, "a"))
      let set = mkSet(ranges)
      test(set, {
        changes: [[300, 500, 100]]
      }, [])
    })

    it("notices adding a collapsed range", () => {
      test([mk(3, 50, {collapsed: true})], {
        add: [mk(40, 80, {collapsed: true})]
      }, [50, 80])
    })

    it("notices removing a collapsed range", () => {
      test([mk(3, 50, {collapsed: true})], {
        filter: () => false
      }, [3, 50])
    })

    it("can handle multiple changes", () => {
      let ranges = []
      for (let i = 0; i < 200; i += 2) {
        let end = i + 1 + Math.ceil(i / 50)
        ranges.push(mk(i, end, `${i}-${end}`))
      }
      test(ranges, {
        changes: [[0, 0, 50], [100, 150, 0], [150, 200, 0]],
        filter: (from: number) => from % 50 > 0
      }, [50, 51, 100, 103, 150, 153])
    })
  })

  class Builder implements RangeIterator<Value> {
    spans: string[] = []
    constructor(public pos: number = 0) {}
    advance(pos: number, active: ReadonlyArray<Value>) {
      if (pos <= this.pos) return
      let name = Value.names(active)
      this.spans.push((pos - this.pos) + (name ? "=" + name : ""))
      this.pos = pos
    }
    advanceCollapsed(pos: number) {
      if (pos <= this.pos) return
      this.spans.push((pos - this.pos) + "=ø")
      this.pos = pos
    }
    point(value: Value) {
      this.spans.push("[" + value.name + "]")
    }
    ignoreRange(value: Value) { return !value.name && !value.collapsed }
    ignorePoint(value: Value) { return !value.name }
  }

  describe("iterateSpans", () => {
    it("separates the range in covering spans", () => {
      let set = mkSet([mk(3, 8, "one"), mk(5, 8, "two"), mk(10, 12, "three")])
      let builder = new Builder(0)
      RangeSet.iterateSpans([set], 0, 15, builder)
      ist(builder.spans.join(" "), "3 2=one 3=one/two 2 2=three 3")
    })

    it("can retrieve a limited range", () => {
      let decos = [mk(0, 200, "wide")]
      for (let i = 0; i < 100; i++) decos.push(mk(i * 2, i * 2 + 2, "span" + i))
      let set = mkSet(decos), start = set.children[0].length + set.children[1].length - 3, end = start + 6
      let expected = ""
      for (let pos = start; pos < end; pos += (pos % 2 ? 1 : 2))
        expected += (expected ? " " : "") + (Math.min(end, pos + (pos % 2 ? 1 : 2)) - pos) + "=wide/span" + Math.floor(pos / 2)
      let builder = new Builder(start)
      RangeSet.iterateSpans([set], start, end, builder)
      ist(builder.spans.join(" "), expected)
    })

    it("ignores decorations that don't affect spans", () => {
      let decos = [mk(0, 10, "yes"), mk(5, 6)], builder = new Builder(2)
      RangeSet.iterateSpans([mkSet(decos)], 2, 15, builder)
      ist(builder.spans.join(" "), "8=yes 5")
    })

    it("reads from multiple sets at once", () => {
      let one = mkSet([mk(2, 3, "x"), mk(5, 10, "y"), mk(10, 12, "z")])
      let two = mkSet([mk(0, 6, "a"), mk(10, 12, "b")])
      let builder = new Builder(0)
      RangeSet.iterateSpans([one, two], 0, 12, builder)
      ist(builder.spans.join(" "), "2=a 1=a/x 2=a 1=a/y 4=y 2=b/z")
    })
  })

  describe("iter", () => {
    it("iterates over all ranges", () => {
      const set = mkSet(smallRanges.concat([mk(1000, 4000, {pos: 1000}), mk(2000, 3000, {pos: 2000})]))
      const iter = set.iter()
      let count = 0
      for(let item; item = iter.next(); ++count) {
        ist(item.from, count > 2001 ? count - 2 : (count > 1000 ? count - 1 : count))
      }
      ist(count, 5002)
    })
  })
})
