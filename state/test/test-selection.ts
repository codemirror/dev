import ist from "ist"
import {EditorSelection, SelectionRange} from "@codemirror/next/state"

describe("EditorSelection", () => {
  it("stores ranges with a primary range", () => {
    let sel = EditorSelection.create([new SelectionRange(0, 1), new SelectionRange(3, 2), new SelectionRange(4, 5)], 1)
    ist(sel.primary.from, 2)
    ist(sel.primary.to, 3)
    ist(sel.primary.anchor, 3)
    ist(sel.primary.head, 2)
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "0/1,3/2,4/5")
  })

  it("merges and sorts ranges when normalizing", () => {
    let sel = EditorSelection.create([
      new SelectionRange(10, 12),
      new SelectionRange(6, 7),
      new SelectionRange(4, 5),
      new SelectionRange(3, 4),
      new SelectionRange(0, 6),
      new SelectionRange(7, 8),
      new SelectionRange(9, 13),
      new SelectionRange(13, 14)
    ])
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "0/6,6/7,7/8,9/13,13/14")
  })

  it("merges adjacent point ranges when normalizing", () => {
    let sel = EditorSelection.create([
      new SelectionRange(10, 12),
      new SelectionRange(12, 12),
      new SelectionRange(12, 12),
      new SelectionRange(10, 10),
      new SelectionRange(8, 10)
    ])
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "8/10,10/12")
  })

  it("preserves the direction of the last range when merging ranges", () => {
    let sel = EditorSelection.create([new SelectionRange(0, 2), new SelectionRange(10, 1)])
    ist(sel.ranges.map(r => r.anchor + "/" + r.head).join(","), "10/0")
  })
})
