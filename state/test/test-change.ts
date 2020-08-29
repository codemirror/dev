import {ChangeDesc, ChangeSet, Text, MapMode} from "@codemirror/next/state"
import ist from "ist"

function mk(spec: string) {
  let sections: number[] = []
  while (spec.length) {
    let next = /^(\d+)(?::(\d+))?\s*/.exec(spec)!
    spec = spec.slice(next[0].length)
    sections.push(+next[1], next[2] == null ? -1 : +next[2])
  }
  return new ChangeDesc(sections)
}

// ('r' for random)
function r(n: number) { return Math.floor(Math.random() * n) }
function rStr(l: number) {
  let result = ""
  for (let i = 0; i < l; i++) result += String.fromCharCode(97 + r(26))
  return result
}
function rChange(len: number): {from: number, to?: number, insert?: string} {
  if (len == 0 || r(3) == 0) return {insert: rStr(r(5) + 1), from: r(len)}
  let from = r(len - 1)
  return {from, to: Math.min(from + r(5) + 1, len), insert: r(2) == 0 ? rStr(r(2) + 1) : undefined}
}
function rChanges(len: number, count: number): {from: number, to?: number, insert?: string}[] {
  let result = []
  for (let i = 0; i < count; i++) result.push(rChange(len))
  return result
}

describe("ChangeDesc", () => {
  describe("composition", () => {
    function comp(...specs: string[]) {
      let result = specs.pop(), sets = specs.map(mk)
      ist(String(sets.reduce((a, b) => a.composeDesc(b))), result)
    }

    it("can compose unrelated changes",
       () => comp("5 0:2", "1 2:0 4", "1 2:0 2 0:2"))

    it("cancels insertions with deletions",
       () => comp("2 0:2 2", "2 2:0 2", "4"))

    it("joins adjacent insertions",
       () => comp("2 0:2 2", "4 0:3 2", "2 0:5 2"))

    it("joins adjacent deletions",
       () => comp("2 5:0", "1 1:0", "1 6:0"))

    it("allows a delete to shadow multiple operations",
       () => comp("2 2:0 0:3", "5:0", "4:0"))

    it("can handle empty sets",
       () => comp("", "0:8", "8:0", "", ""))

    it("can join multiple replaces", () => {
      comp("2 2:2 2:2 2", "1 2:2 2:2 2:2 1", "1 6:6 1")
      comp("1 2:2 2:2 2:2 1", "2 2:2 2:2 2", "1 6:6 1")
      comp("1 2:3 3:2 1", "2 3:1 2", "1 5:3 1")
    })

    it("throws for inconsistent lengths", () => {
      ist.throws(() => mk("2 0:2").composeDesc(mk("1 0:1")))
      ist.throws(() => mk("2 0:2").composeDesc(mk("30 0:1")))
      ist.throws(() => mk("2 2:0 0:3").composeDesc(mk("7:0")))
    })
  })

  describe("mapping", () => {
    function over(a: string, b: string, result: string) {
      ist(String(mk(a).mapDesc(mk(b))), result)
    }
    function under(a: string, b: string, result: string) {
      ist(String(mk(a).mapDesc(mk(b), true)), result)
    }

    it("can map over an insertion",
       () => over("4 0:1", "0:3 4" , "7 0:1"))

    it("can map over a deletion",
       () => over("4 0:1", "2:0 2", "2 0:1"))

    it("orders insertions", () => {
      over("2 0:1 2", "2 0:1 2", "3 0:1 2")
      under("2 0:1 2", "2 0:1 2", "2 0:1 3")
    })

    it("can map a deletion over an overlapping replace", () => {
      over("2 2:0", "2 1:2 1", "4 1:0")
      under("2 2:0", "2 1:2 1", "4 1:0")
    })

    it("can handle changes after",
       () => over("0:1 2:0 8", "6 1:0 0:5 3", "0:1 2:0 12"))

    it("joins deletions",
       () => over("5:0 2 3:0 2", "4 4:0 4", "6:0 2"))

    it("drops insertions in deletions", () => {
      under("2 0:1 2", "4:0", "")
      over("4 0:1 4", "2 4:0 2", "4")
    })

    it("keeps replacements", () => {
      over("2 2:2 2", "0:2 6", "4 2:2 2")
      over("2 2:2 2", "3:0 3", "1:2 2")
      over("1 4:4 1", "3 0:2 3", "1 6:4 1")
      over("1 4:4 1", "2 2:0 2", "1 2:4 1")
      over("2 2:2 2", "3 2:0 1", "2 1:2 1")
    })

    it("doesn't join replacements", () => {
      over("2:2 2 2:2", "2 2:0 2", "2:2 2:2")
    })

    it("drops duplicate deletion", () => {
      under("2 2:0 2", "2 2:0 2", "4")
      over("2 2:0 2", "2 2:0 2", "4")
    })

    it("handles overlapping replaces", () => {
      over("1 1:2 1", "1 1:1 1", "2 0:2 1")
      under("1 1:2 1", "1 1:1 1", "1 0:2 2")
      over("1 1:2 2", "1 2:1 1", "1 0:2 2")
      over("2 1:2 1", "1 2:1 1", "2 0:2 1")
      over("2:1 1", "1 2:2", "1:1 2")
      over("1 2:1", "2:2 1", "2 1:1")
    })
  })

  describe("mapPos", () => {
    function map(spec: string, ...cases: [number, number, (number | string)?][]) {
      let set = mk(spec)
      for (let [from, to, opt] of cases) {
        let assoc = typeof opt == "number" ? opt : -1
        let mode = ({D: MapMode.TrackDel, A: MapMode.TrackAfter, B: MapMode.TrackBefore} as any)[opt as any]
        ist(set.mapPos(from, assoc, mode), to)
      }
    }

    it("maps through an insertion", () =>
       map("4 0:2 4", [0, 0], [4, 4], [4, 6, 1], [5, 7], [8, 10]))

    it("maps through deletion", () =>
       map("4 4:0 4", [0, 0],
           [4, 4], [4, 4, "D"], [4, 4, "B"], [4, -1, "A"],
           [5, 4], [5, -1, "D"], [5, -1, "B"], [5, -1, "A"],
           [7, 4],
           [8, 4], [8, 4, "D"], [8, -1, "B"], [8, 4, "A"],
           [9, 5], [12, 8]))

    it("maps through multiple insertions", () =>
       map("0:2 2 0:2 2 0:2",
           [0, 0], [0, 2, 1], [1, 3], [2, 4], [2, 6, 1], [3, 7], [4, 8], [4, 10, 1]))

    it("maps through multiple deletions", () =>
       map("2:0 2 2:0 2 2:0",
           [0, 0], [1, 0], [2, 0], [3, 1], [4, 2], [5, 2], [6, 2], [7, 3], [8, 4], [9, 4], [10, 4]))

    it("maps through mixed edits", () =>
       map("2 0:2 2:0 0:2 2 2:0 0:2",
           [0, 0], [2, 2], [2, 4, 1], [3, 4], [4, 4], [4, 6, 1], [5, 7], [6, 8], [7, 8], [8, 8], [8, 10, 1]))

    it("stays on its own side of replacements", () =>
       map("2 2:2 2",
           [2, 2, 1], [2, 2, -1], [2, 2, "D"], [2, 2, "B"], [2, -1, "A"],
           [3, 2, -1], [3, 4, 1], [3, -1, "D"], [3, -1, "B"], [3, -1, "A"],
           [4, 4, 1], [4, 4, -1], [4, 4, "D"], [4, -1, "B"], [4, 4, "A"]))

    it("maps through insertions around replacements", () =>
       map("0:1 2:2 0:1",
           [0, 0, -1], [0, 1, 1],
           [1, 1, -1], [1, 3, 1],
           [2, 3, -1], [2, 4, 1]))

    it("stays in between replacements", () =>
       map("2:2 2:2", [2, 2, -1], [2, 2, 1]))
  })

  describe("mapPosStable", () => {
    function map(spec: string, ...cases: [number, number, number?][]) {
      let set = mk(spec)
      for (let [from, to, assoc] of cases) ist(set.mapPosStable(from, assoc), to)
    }

    it("maps through replacements", () =>
       map("4 4:4 4", [0, 0], [1, 1], [4, 4], [4, 8, 1], [6, 4], [6, 8, 1], [8, 4], [8, 8, 1], [9, 9]))

    it("maps through insertions", () =>
       map("3 0:3 3", [0, 0], [3, 3], [3, 6, 1], [6, 9]))

    it("maps through deletions", () =>
       map("3 3:0 3", [0, 0], [3, 3], [6, 3]))

    it("maps through separate changes", () =>
       map("2:1 3 1:2 1", [0, 0], [0, 1, 1], [1, 0], [1, 1, 1], [2, 0], [3, 2], [5, 4], [5, 6, 1], [6, 4], [6, 6, 1], [7, 7]))

    it("maps through a group of changes", () =>
       map("2 2:1 3:0 1:1 0:3 2", [0, 0], [2, 2], [2, 7, 1], [4, 2], [4, 7, 1], [6, 2], [6, 7, 1], [8, 2], [8, 7, 1], [9, 8]))

    it("is not affected by change order", () => {
      for (let i = 0; i < 100; i++) {
        let size = r(20), a = ChangeSet.of(rChanges(size, 10), size), b = ChangeSet.of(rChanges(size, 10), size)
        let ab = a.composeDesc(b.mapDesc(a)), ba = b.composeDesc(a.mapDesc(b))
        for (let p = 0; p <= size; p++) {
          ist(ab.mapPosStable(p), ba.mapPosStable(p))
          ist(ab.mapPosStable(p, 1), ba.mapPosStable(p, 1))
        }
      }
    })
  })
})

describe("ChangeSet", () => {
  it("can create change sets", () => {
    ist(ChangeSet.of([{insert: "hi", from: 5}], 10).desc.toString(), "5 0:2 5")
    ist(ChangeSet.of([{from: 5, to: 7}], 10).desc.toString(), "5 2:0 3")
    ist(ChangeSet.of([
      {insert: "hi", from: 5}, {insert: "ok", from: 5},
      {from: 0, to: 3}, {from: 4, to: 6},
      {insert: "boo", from: 8}
    ], 10).desc.toString(), "3:0 1 2:0 2 0:3 2")
  })

  let doc10 = Text.of(["0123456789"])

  it("can apply change sets", () => {
    ist(ChangeSet.of([{insert: "ok", from: 2}], 10).apply(doc10).toString(), "01ok23456789")
    ist(ChangeSet.of([{from: 1, to: 9}], 10).apply(doc10).toString(), "09")
    ist(ChangeSet.of([{from: 2, to: 8}, {insert: "hi", from: 1}], 10).apply(doc10).toString(), "0hi189")
  })

  it("can apply composed sets", () => {
    ist(ChangeSet.of([{insert: "ABCD", from: 8}], 10)
        .compose(ChangeSet.of([{from: 8, to: 11}], 14))
        .apply(doc10).toString(), "01234567D89")
    ist(ChangeSet.of([{insert: "hi", from: 2}, {insert: "ok", from: 8}], 10)
        .compose(ChangeSet.of([{insert: "!", from: 4}, {from: 6, to: 8}, {insert: "?", from: 12}], 14))
        .apply(doc10).toString(), "01hi!2367ok?89")
  })

  it("can clip inserted strings on compose", () => {
    ist(ChangeSet.of([{insert: "abc", from: 2}, {insert: "def", from: 4}], 10)
        .compose(ChangeSet.of([{from: 4, to: 8}], 16))
        .apply(doc10).toString(), "01abef456789")
  })

  it("can apply mapped sets", () => {
    let set0 = ChangeSet.of([{insert: "hi", from: 5}, {from: 8, to: 10}], 10)
    let set1 = ChangeSet.of([{insert: "ok", from: 10}, {from: 6, to: 7}], 10)
    ist(set0.compose(set1.map(set0)).apply(doc10).toString(), "01234hi57ok")
  })

  it("can apply inverted sets", () => {
    let set0 = ChangeSet.of([{insert: "hi", from: 5}, {from: 8, to: 10}], 10)
    ist(set0.invert(doc10).apply(set0.apply(doc10)).toString(), doc10.toString())
  })

  it("can be iterated", () => {
    let set = ChangeSet.of([{insert: "ok", from: 4}, {from: 6, to: 8}], 10)
    let result: any[] = []
    set.iterChanges((fromA, toA, fromB, toB, inserted) => result.push([fromA, toA, fromB, toB, inserted.toString()]))
    ist(JSON.stringify(result),
        JSON.stringify([[4, 4, 4, 6, "ok"], [6, 8, 8, 8, ""]]))
    result = []
    set.iterGaps((fromA, toA, len) => result.push([fromA, toA, len]))
    ist(JSON.stringify(result),
        JSON.stringify([[0, 0, 4], [4, 6, 2], [8, 8, 2]]))
  })

  it("mapping before produces the same result as mapping the other after", () => {
    for (let i = 0, total = 100; i < total; i++) {
      let size = r(20), count = Math.floor(i / (total / 10)) + 1
      let a = rChanges(size, count), b = rChanges(size, count)
      try {
        let setA = ChangeSet.of(a, size), setB = ChangeSet.of(b, size)
        let setA1 = setA.map(setB, true), setB1 = setB.map(setA, false)
        let doc = Text.of([rStr(size)])
        let setAB = setA.compose(setB1), setBA = setB.compose(setA1)
        ist(setAB.apply(doc).toString(), setBA.apply(doc).toString())
      } catch (e) {
        console.log(`a = ChangeSet.of(${JSON.stringify(a)}, ${size})\nb = ChangeSet.of(${JSON.stringify(b)}, ${size})`)
        throw e
      }
    }
  })

  it("mapping still converges when mapping through multiple changes", () => {
    for (let i = 0, total = 100; i < total; i++) {
      let size = r(20), count = Math.floor(i / (total / 10)) + 1
      let a = ChangeSet.of(rChanges(size, count), size)
      let b = ChangeSet.of(rChanges(a.newLength, count), a.newLength)
      let c = ChangeSet.of(rChanges(size, count), size)
      let c$a = c.map(a), c$ab = c$a.map(b)
      let a$c = a.map(c, true), b$ca = b.map(c$a, true)
      let doc = Text.of([rStr(size)])
      ist(a.compose(b).compose(c$ab).apply(doc).toString(),
          c.compose(a$c).compose(b$ca).apply(doc).toString())
    }
  })

  it("compose produces the same result as individual changes", () => {
    for (let i = 0; i < 100; i++) {
      let size = r(20), doc = Text.of([rStr(size)])
      let a = ChangeSet.of(rChanges(size, r(5) + 1), size)
      let b = ChangeSet.of(rChanges(a.newLength, r(6)), a.newLength)
      ist(b.apply(a.apply(doc)).toString(), a.compose(b).apply(doc).toString())
    }
  })

  it("composing is associative", () => {
    for (let i = 0; i < 100; i++) {
      let size = r(20), doc = Text.of([rStr(size)])
      let a = ChangeSet.of(rChanges(size, r(5) + 1), size)
      let b = ChangeSet.of(rChanges(a.newLength, r(6)), a.newLength)
      let c = ChangeSet.of(rChanges(b.newLength, r(5) + 1), b.newLength)
      let left = a.compose(b).compose(c), right = a.compose(b.compose(c))
      ist(left.apply(doc).toString(), right.apply(doc).toString())
    }
  })

  it("survives random sequences of changes", () => {
    for (let i = 0; i < 50; i++) {
      let doc = doc10, txt = doc.toString(), all: ChangeSet[] = [], inv: ChangeSet[] = []
      let log = []
      try {
        for (let j = 0; j < 50; j++) {
          let set: ChangeSet, change = rChange(doc.length)
          log.push(`ChangeSet.of([${JSON.stringify(change)}], ${doc.length})`)
          let {from, to = from, insert = ""} = change
          txt = txt.slice(0, from) + insert + txt.slice(to)
          set = ChangeSet.of([change], doc.length)
          all.push(set)
          inv.push(set.invert(doc))
          doc = set.apply(doc)
          ist(doc.toString(), txt)
        }
        let composed = all.reduce((a, b) => a.compose(b), ChangeSet.of([], doc10.length))
        ist(composed.apply(doc10).toString(), txt)
        ist(composed.invert(doc10).apply(doc).toString(), doc10.toString())
        for (let i = inv.length - 1; i >= 0; i--) doc = inv[i].apply(doc)
        ist(doc.toString(), doc10.toString())
      } catch(e) {
        console.log("With changes: ", log.join(", "))
        throw e
      }
    }
  })

  it("can be serialized to JSON", () => {
    for (let i = 0; i < 100; i++) {
      let size = r(20) + 1, set = ChangeSet.of(rChanges(size, r(4)), size)
      ist(String(ChangeSet.fromJSON(set.toJSON())), String(set))
    }
  })
})
