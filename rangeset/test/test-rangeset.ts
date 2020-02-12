import {Range, RangeSet, RangeValue, RangeComparator, RangeIterator} from ".."
import {Change, ChangeSet, ChangedRange} from "../../state"
import ist from "ist"

class Value extends RangeValue {
  startSide: number
  endSide: number
  point: boolean
  name: string | null
  pos: number | null
  constructor(spec: any = {}, empty: boolean) {
    super()
    this.startSide = spec.startSide || 1
    this.endSide = spec.endSide || (empty ? 1 : -1)
    this.point = empty || !!spec.point
    this.name = spec.name || null
    this.pos = spec.pos == null ? null : spec.pos
  }
  eq(other: RangeValue): boolean {
    return other instanceof Value && other.name == this.name
  }
  static names(v: readonly Value[]): string {
    let result = []
    for (let val of v) if (val.name || val.point) result.push(val.name || "POINT")
    return result.sort().join("/")
  }
}

function cmp(a: Range<Value>, b: Range<Value>) { return a.from - b.from }

function mk(from: number, to?: any, spec?: any): Range<Value> {
  if (typeof to != "number") { spec = to; to = from }
  if (typeof spec == "string") spec = {name: spec}
  return new Range(from, to, new Value(spec, from == to))
}
function mkSet(ranges: Range<Value>[]) { return RangeSet.of<Value>(ranges) }

let smallRanges: Range<Value>[] = []
for (let i = 0; i < 5000; i++)
  smallRanges.push(mk(i, i + 1 + (i % 4), {pos: i}))
let _set0: RangeSet<Value> | null = null
function set0() { return _set0 || (_set0 = mkSet(smallRanges)) }

function checkSet(set: RangeSet<Value>) {
  let count = 0
  set.between(0, set.length, (from, _, value) => {
    count++
    if (value.pos != null) ist(from, value.pos)
  })
  ist(count, set.size)
}

describe("RangeSet", () => {
  it("divides a set into chunks and layers", () => {
    let set = mkSet(smallRanges.concat([mk(1000, 4000, {pos: 1000}), mk(2000, 3000, {pos: 2000})]).sort(cmp))
    ist(set.size, 5002)
    ist(set.chunk.length, 1, ">")
    ist(set.nextLayer.size)
    checkSet(set)
  })

  it("complains about misordered ranges", () => {
    ist.throws(() => mkSet([mk(8, 9), mk(7, 10)]), /sorted/)
    ist.throws(() => mkSet([mk(1, 1, {startSide: 1}), mk(1, 1, {startSide: -1})]), /sorted/)
  })

  describe("update", () => {
    it("can add ranges", () => {
      let set = set0().update({add: [mk(4000, {pos: 4000})]})
      ist(set.size, 5001)
      ist(set.chunk[0], set0().chunk[0])
    })

    it("can add a large amount of ranges", () => {
      let ranges = []
      for (let i = 0; i < 4000; i += 2) ranges.push(mk(i))
      let set = set0().update({add: ranges})
      ist(set.size, 2000 + set0().size)
      checkSet(set)
    })

    it("can filter ranges", () => {
      let set = set0().update({filter: from => from >= 2500})
      ist(set.size, 2500)
      ist(set.chunk.length, set0().chunk.length, "<")
      checkSet(set)
    })

    it("can filter all over", () => {
      let set = set0().update({filter: from => (from % 200) >= 100})
      ist(set.size, 2500)
      checkSet(set)
    })

    it("collapses the chunks when removing almost all ranges", () => {
      let set = set0().update({filter: from => from == 500 || from == 501})
      ist(set.size, 2)
      ist(set.chunk.length, 1)
    })

    it("calls filter on precisely those ranges touching the filter range", () => {
      let ranges = []
      for (let i = 0; i < 1000; i++) ranges.push(mk(i, i + 1, {pos: i}))
      let set = mkSet(ranges)
      let called: [number, number][] = []
      set.update({filter: (from, to) => (called.push([from, to]), true), filterFrom: 400, filterTo: 600})
      ist(called.length, 202)
      for (let i = 399, j = 0; i <= 600; i++, j++)
        ist(called[j].join(), `${i},${i+1}`)
    })

    it("returns the empty set when filter removes everything", () => {
      ist(set0().update({filter: () => false}), RangeSet.empty)
    })
  })

  describe("map", () => {
    function test(positions: Range<Value>[], changes: [number, number, number][], newPositions: (number | [number, number])[]) {
      let set = mkSet(positions)
      let mapped = set.map(new ChangeSet(changes.map(([from, to, len]) => new Change(from, to, ["x".repeat(len)]))))
      let out: string[] = []
      for (let iter = mapped.iter(); iter.value; iter.next()) out.push(iter.from + "-" + iter.to)
      ist(JSON.stringify(out), JSON.stringify(newPositions.map(p => Array.isArray(p) ? p[0] + "-" + p[1] : p + "-" + p)))
    }

    it("can map through changes", () =>
       test([mk(1), mk(4), mk(10)], [[0, 0, 1], [2, 3, 0], [8, 8, 20]], [2, 4, 30]))

    it("takes inclusivity into account", () =>
       test([mk(1, 2, {startSide: -1, endSide: 1})], [[1, 1, 2], [4, 4, 2]], [[1, 6]]))

    it("uses side to determine mapping of points", () =>
       test([mk(1, 1, {startSide: -1, endSide: -1}), mk(1, 1, {startSide: 1, endSide: 1})], [[1, 1, 2]], [1, 3]))

    it("defaults to exclusive on both sides", () =>
       test([mk(1, 2)], [[1, 1, 2], [4, 4, 2]], [[3, 4]]))

    it("drops point ranges", () =>
       test([mk(1, 2)], [[1, 2, 0], [1, 1, 1]], []))

    it("drops ranges in deleted regions", () =>
       test([mk(1, 2), mk(3)], [[0, 4, 0]], []))

    it("shrinks ranges", () =>
       test([mk(2, 4), mk(2, 8), mk(6, 8)], [[3, 7, 0]], [[2, 3], [2, 4], [3, 4]]))

    it("leaves point ranges on change boundaries", () =>
       test([mk(2), mk(4)], [[2, 4, 6]], [2, 8]))

    it("can collapse chunks", () => {
      let smaller = set0().map(new ChangeSet([new Change(30, 4500, [""])]))
      ist(smaller.chunk.length, set0().chunk.length, "<")
      let empty = smaller.map(new ChangeSet([new Change(0, 1000, [""])]))
      ist(empty, RangeSet.empty)
    })
  })

  class Comparator implements RangeComparator<Value> {
    ranges: number[] = []
    addRange(from: number, to: number) {
      if (this.ranges.length && this.ranges[this.ranges.length - 1] == from) this.ranges[this.ranges.length - 1] = to
      else this.ranges.push(from, to)
    }
    compareRange(from: number, to: number) { this.addRange(from, to) }
    comparePoint(from: number, to: number) { this.addRange(from, to) }
  }

  describe("compare", () => {
    function test(ranges: RangeSet<Value> | Range<Value>[], update: any, changes: number[]) {
      let set = Array.isArray(ranges) ? mkSet(ranges) : ranges
      let newSet = set
      let docRanges: ChangedRange[] = []
      if (update.changes) {
        let changes = new ChangeSet(update.changes.map(([from, to, len]: [number, number, number]) => {
          return new Change(from, to, ["x".repeat(len)])
        }))
        newSet = newSet.map(changes)
        docRanges = changes.changedRanges()
      }
      if (update.filter || update.add) newSet = newSet.update(update)
      if (update.prepare) update.prepare(newSet)
      let comp = new Comparator
      RangeSet.compare([set], [newSet], 0, 1e8, docRanges, comp)
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
      for (let i = 0; i < 1000; i++) ranges.push(mk(i, i + 1, "a"))
      test(ranges, {
        changes: [[900, 1000, 0]],
        add: [mk(850, 860, "b")],
        prepare: (set: RangeSet<Value>) => Object.defineProperty(set.chunk[0], "value", {get() { throw new Error("NO TOUCH") }})
      }, [850, 860])
    })

    it("ignores changes in points", () => {
      let ranges = [mk(3, 997, {point: true})]
      for (let i = 0; i < 1000; i += 2) ranges.push(mk(i, i + 1, "a"))
      let set = mkSet(ranges.sort(cmp))
      test(set, {
        changes: [[300, 500, 100]]
      }, [])
    })

    it("notices adding a point", () => {
      test([mk(3, 50, {point: true})], {
        add: [mk(40, 80, {point: true})]
      }, [50, 80])
    })

    it("notices removing a point", () => {
      test([mk(3, 50, {point: true})], {
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
    span(from: number, to: number, active: readonly Value[]) {
      let name = Value.names(active)
      this.spans.push((to - from) + (name ? "=" + name : ""))
    }
    point(from: number, to: number, value: Value) {
      return (to > from ? (to - from) + "=" : "") + (value.name ? "[" + value.name + "]" : "ø")
    }
  }

  describe("spans", () => {
    it("separates the range in covering spans", () => {
      let set = mkSet([mk(3, 8, "one"), mk(5, 8, "two"), mk(10, 12, "three")])
      let builder = new Builder
      RangeSet.spans([set], 0, 15, builder)
      ist(builder.spans.join(" "), "3 2=one 3=one/two 2 2=three 3")
    })

    it("can retrieve a limited range", () => {
      let decos = [mk(0, 200, "wide")]
      for (let i = 0; i < 100; i++) decos.push(mk(i * 2, i * 2 + 2, "span" + i))
      let set = mkSet(decos), start = 20, end = start + 6
      let expected = ""
      for (let pos = start; pos < end; pos += (pos % 2 ? 1 : 2))
        expected += (expected ? " " : "") + (Math.min(end, pos + (pos % 2 ? 1 : 2)) - pos) + "=span" + Math.floor(pos / 2) + "/wide"
      let builder = new Builder
      RangeSet.spans([set], start, end, builder)
      ist(builder.spans.join(" "), expected)
    })

    it("reads from multiple sets at once", () => {
      let one = mkSet([mk(2, 3, "x"), mk(5, 10, "y"), mk(10, 12, "z")])
      let two = mkSet([mk(0, 6, "a"), mk(10, 12, "b")])
      let builder = new Builder
      RangeSet.spans([one, two], 0, 12, builder)
      ist(builder.spans.join(" "), "2=a 1=a/x 2=a 1=a/y 4=y 2=b/z")
    })
  })

  describe("iter", () => {
    it("iterates over ranges", () => {
      const set = mkSet(smallRanges.concat([mk(1000, 4000, {pos: 1000}), mk(2000, 3000, {pos: 2000})]).sort(cmp))
      let count = 0
      for(let iter = set.iter(); iter.value; iter.next(), count++) {
        ist(iter.from, count > 2001 ? count - 2 : (count > 1000 ? count - 1 : count))
      }
      ist(count, 5002)
    })

    it("can iterate over a subset", () => {
      let count = 0
      for (let iter = set0().iter(1000); iter.value; iter.next(), count++) {
        if (iter.from > 2000) break
        ist(iter.to, iter.from + 1 + (iter.from % 4))
      }
      ist(count, 1003)
    })
  })

  describe("between", () => {
    it("iterates over ranges", () => {
      let found = 0
      set0().between(100, 200, (from, to) => {
        ist(to, from + 1 + (from % 4))
        ist(to, 100, ">=")
        ist(from, 200, "<=")
        found++
      })
      ist(found, 103)
    })
  })
})
