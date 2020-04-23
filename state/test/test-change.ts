import {ChangeDesc, ChangeSet, Text, MapMode, Section} from "@codemirror/next/state"
import ist from "ist"

function mk(spec: string) {
  let sections: [Section, number][] = []
  while (spec.length) {
    let next = /^([idk])(\d+)/.exec(spec)!
    spec = spec.slice(next[0].length)
    sections.push([next[1] == "i" ? Section.Insert : next[1] == "d" ? Section.Delete : Section.Keep, Number(next[2])])
  }
  return ChangeDesc.make(sections)
}

describe("ChangeDesc", () => {
  describe("composition", () => {
    function comp(...specs: string[]) {
      let result = specs.pop(), sets = specs.map(mk)
      ist(String(sets.reduce((a, b) => a.composeDesc(b))), result)
    }

    it("can compose unrelated changes",
       () => comp("k5i2", "k1d2k4", "k1d2k2i2"))

    it("cancels insertions with deletions",
       () => comp("k2i2k2", "k2d2k2", "k4"))

    it("joins adjacent insertions",
       () => comp("k2i2k2", "k4i3k2", "k2i5k2"))

    it("joins adjacent deletions",
       () => comp("k2d5", "k1d1", "k1d6"))

    it("allows a delete to shadow multiple operations",
       () => comp("i2d2k2i3", "d7", "d4"))

    it("can handle empty sets",
       () => comp("", "i8", "d8", "", ""))

    it("throws for inconsistent lengths", () => {
      ist.throws(() => mk("k2i2").composeDesc(mk("k1d1")))
      ist.throws(() => mk("k2i2").composeDesc(mk("k30d1")))
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
       () => over("k4i1", "i3k4" , "k7i1"))

    it("can map over a deletion",
       () => over("k4i1", "d2k2", "k2i1"))

    it("orders insertions", () => {
      over("k2i1k2", "k2i1k2", "k3i1k2")
      under("k2i1k2", "k2i1k2", "k2i1k3")
    })

    it("can handle changes after",
       () => over("i1d2k8", "k6d1i5k3", "i1d2k12"))

    it("joins deletions",
       () => over("d5k2d3k2", "k4d4k4", "d6k2"))

    it("preserves insertions in deletions", () => {
      under("k2i1k2", "d4", "i1")
      over("k4i1k4", "k2d4k2", "k2i1k2")
    })

    it("drops duplicate deletion",
       () => under("k2d2k2", "k2d2k2", "k4"))
  })

  describe("mapPos", () => {
    function map(spec: string, ...cases: [number, number, number?, number?][]) {
      let set = mk(spec)
      for (let [from, to, assoc = -1, mode = MapMode.Simple] of cases) ist(set.mapPos(from, assoc, mode), to)
    }

    it("maps through an insertion",
       () => map("k4i2k4", [0, 0], [4, 4], [4, 6, 1], [5, 7], [8, 10]))

    it("maps through deletion",
       () => map("k4d4k4", [0, 0],
                 [4, 4],
                 [4, 4, 0, MapMode.TrackDel], [4, 4, 0, MapMode.TrackBefore], [4, -1, 0, MapMode.TrackAfter],
                 [5, 4], [5, -1, 0, MapMode.TrackDel], [5, -1, 0, MapMode.TrackBefore], [5, -1, 0, MapMode.TrackAfter],
                 [7, 4],
                 [8, 4], [8, 4, 0, MapMode.TrackDel], [8, -1, 0, MapMode.TrackBefore], [8, 4, 0, MapMode.TrackAfter],
                 [9, 5], [12, 8]))

    it("maps through multiple insertions",
       () => map("i2k2i2k2i2", [0, 0], [0, 2, 1], [1, 3], [2, 4], [2, 6, 1], [3, 7], [4, 8], [4, 10, 1]))

    it("maps through multiple deletions",
       () => map("d2k2d2k2d2", [0, 0], [1, 0], [2, 0], [3, 1], [4, 2], [5, 2], [6, 2], [7, 3], [8, 4], [9, 4], [10, 4]))

    it("maps through mixed edits",
       () => map("k2i2d2i2k2d2i2", [0, 0], [2, 2], [2, 4, 1], [3, 4], [4, 4], [4, 6, 1], [5, 7], [6, 8], [7, 8], [8, 8], [8, 10, 1]))
  })
})

describe("ChangeSet", () => {
  it("can create change sets", () => {
    ist(ChangeSet.of(10, [{insert: ["hi"], at: 5}]).desc.toString(), "k5i2k5")
    ist(ChangeSet.of(10, [{delete: 5, to: 7}]).desc.toString(), "k5d2k3")
    ist(ChangeSet.of(10, [
      {insert: ["hi"], at: 5}, {insert: ["ok"], at: 5},
      {delete: 0, to: 3}, {delete: 4, to: 6},
      {insert: ["boo"], at: 8}
    ]).desc.toString(), "d3k1d1i4d1k2i3k2")
  })

  let doc10 = Text.of(["0123456789"])

  it("can apply change sets", () => {
    ist(ChangeSet.of(10, [{insert: ["ok"], at: 2}]).apply(doc10).toString(), "01ok23456789")
    ist(ChangeSet.of(10, [{delete: 1, to: 9}]).apply(doc10).toString(), "09")
    ist(ChangeSet.of(10, [{delete: 2, to: 8}, {insert: ["hi"], at: 5}]).apply(doc10).toString(), "01hi89")
  })

  it("can apply composed sets", () => {
    ist(ChangeSet.of(10, [{insert: ["hi"], at: 2}, {insert: ["ok"], at: 8}])
        .compose(ChangeSet.of(14, [{insert: ["!"], at: 4}, {delete: 6, to: 8}, {insert: ["?"], at: 12}]))
        .apply(doc10).toString(), "01hi!2367ok?89")
  })

  it("can clip inserted strings on compose", () => {
    ist(ChangeSet.of(10, [{insert: ["abc"], at: 2}, {insert: ["def"], at: 4}])
        .compose(ChangeSet.of(16, [{delete: 4, to: 8}]))
        .apply(doc10).toString(), "01abef456789")
  })

  it("can apply mapped sets", () => {
    let set0 = ChangeSet.of(10, [{insert: ["hi"], at: 5}, {delete: 8, to: 10}])
    let set1 = ChangeSet.of(10, [{insert: ["ok"], at: 9}, {delete: 6, to: 7}])
    ist(set0.compose(set1.map(set0)).apply(doc10).toString(), "01234hi57ok")
  })

  it("can apply inverted sets", () => {
    let set0 = ChangeSet.of(10, [{insert: ["hi"], at: 5}, {delete: 8, to: 10}])
    ist(set0.invert(doc10).apply(set0.apply(doc10)).toString(), doc10.toString())
  })

  it("can be iterated", () => {
    let set = ChangeSet.of(10, [{insert: ["ok"], at: 4}, {delete: 6, to: 8}])
    let result: any[] = []
    set.iter((type, fromA, toA, fromB, toB, inserted) => {
      result.push([type == Section.Keep ? "k" : type == Section.Delete ? "d" : "i",
                   fromA, toA, fromB, toB, inserted])
    })
    ist(JSON.stringify(result),
        JSON.stringify([["k", 0, 4, 0, 4, null],
                        ["i", 4, 4, 4, 6, ["ok"]],
                        ["k", 4, 6, 6, 8, null],
                        ["d", 6, 8, 8, 8, null],
                        ["k", 8, 10, 8, 10, null]]))
  })

  function r(n: number) { return Math.floor(Math.random() * n) }
  function rT(l: number) {
    let result = ""
    for (let i = 0; i < l; i++) result += String.fromCharCode(97 + r(26))
    return result
  }

  it("survives generated tests", () => {
    for (let i = 0; i < 50; i++) {
      let doc = doc10, txt = doc.toString(), all: ChangeSet[] = [], inv: ChangeSet[] = []
      for (let j = 0; j < 50; j++) {
        let set
        if (r(2) == 1 || doc.length == 0) {
          let insert = rT(r(5) + 1), at = r(doc.length)
          txt = txt.slice(0, at) + insert + txt.slice(at)
          set = ChangeSet.of(doc.length, [{insert: [insert], at}])
        } else {
          let from = r(doc.length - 1), to = Math.min(from + r(5) + 1, doc.length)
          txt = txt.slice(0, from) + txt.slice(to)
          set = ChangeSet.of(doc.length, [{delete: from, to}])
        }
        all.push(set)
        inv.push(set.invert(doc))
        doc = set.apply(doc)
        ist(doc.toString(), txt)
      }
      let composed = all.reduce((a, b) => a.compose(b), ChangeSet.of(doc10.length, []))
      ist(composed.apply(doc10).toString(), txt)
      ist(composed.invert(doc10).apply(doc).toString(), doc10.toString())
      for (let i = inv.length - 1; i >= 0; i--) doc = inv[i].apply(doc)
      ist(doc.toString(), doc10.toString())
    }
  })
})
