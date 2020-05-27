import ist from "ist"
import {EditorSelection} from "@codemirror/next/state"

describe("EditorSelection", () => {
  it("stores ranges with a primary range", () => {
    let sel = EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(3, 2), EditorSelection.range(4, 5)], 1)
    ist(sel.primary.from, 2)
    ist(sel.primary.to, 3)
    ist(sel.primary.anchor, 3)
    ist(sel.primary.head, 2)
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "0/1,3/2,4/5")
  })

  it("merges and sorts ranges when normalizing", () => {
    let sel = EditorSelection.create([
      EditorSelection.range(10, 12),
      EditorSelection.range(6, 7),
      EditorSelection.range(4, 5),
      EditorSelection.range(3, 4),
      EditorSelection.range(0, 6),
      EditorSelection.range(7, 8),
      EditorSelection.range(9, 13),
      EditorSelection.range(13, 14)
    ])
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "0/6,6/7,7/8,9/13,13/14")
  })

  it("merges adjacent point ranges when normalizing", () => {
    let sel = EditorSelection.create([
      EditorSelection.range(10, 12),
      EditorSelection.range(12, 12),
      EditorSelection.range(12, 12),
      EditorSelection.range(10, 10),
      EditorSelection.range(8, 10)
    ])
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "8/10,10/12")
  })

  it("preserves the direction of the last range when merging ranges", () => {
    let sel = EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(10, 1)])
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "10/0")
  })
})
