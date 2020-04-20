import {ChangeDesc} from "@codemirror/next/text"
import ist from "ist"

function mk(spec: string) {
  let sections: ["keep" | "del" | "ins", number][] = []
  while (spec.length) {
    let next = /^([idk])(\d+)/.exec(spec)!
    spec = spec.slice(next[0].length)
    sections.push([next[1] == "i" ? "ins" : next[1] == "d" ? "del" : "keep", Number(next[2])])
  }
  return ChangeDesc.of(sections)
}

describe("Change composition", () => {
  function comp(...specs: string[]) {
    let result = specs.pop(), sets = specs.map(mk)
    ist(String(sets.reduce((a, b) => a.compose(b))), result)
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
    ist.throws(() => mk("k2i2").compose(mk("k1d1")))
    ist.throws(() => mk("k2i2").compose(mk("k30d1")))
  })
})

describe("mapping", () => {
  function over(a: string, b: string, result: string) {
    ist(String(mk(a).map(mk(b))), result)
  }
  function under(a: string, b: string, result: string) {
    ist(String(mk(a).map(mk(b), true)), result)
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
  function map(spec: string, ...cases: ([number, number] | [number, number, number])[]) {
    let set = mk(spec)
    for (let [from, to, assoc = -1] of cases) ist(set.mapPos(from, assoc), to)
  }

  it("maps through an insertion",
     () => map("k4i2k4", [0, 0], [4, 4], [4, 6, 1], [5, 7], [8, 10]))

  it("maps through deletion",
     () => map("k4d4k4", [0, 0], [4, 4], [5, 4], [7, 4], [8, 4], [9, 5], [12, 8]))

  it("maps through multiple insertions",
     () => map("i2k2i2k2i2", [0, 0], [0, 2, 1], [1, 3], [2, 4], [2, 6, 1], [3, 7], [4, 8], [4, 10, 1]))

  it("maps through multiple deletions",
     () => map("d2k2d2k2d2", [0, 0], [1, 0], [2, 0], [3, 1], [4, 2], [5, 2], [6, 2], [7, 3], [8, 4], [9, 4], [10, 4]))

  it("maps through mixed edits",
     () => map("k2i2d2i2k2d2i2", [0, 0], [2, 2], [2, 4, 1], [3, 4], [4, 4], [4, 6, 1], [5, 7], [6, 8], [7, 8], [8, 8], [8, 10, 1]))
})
