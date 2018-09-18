import {tempEditor, requireFocus} from "./temp-editor"
import {EditorSelection} from "../../state/src"
import ist from "ist"

const visualBidi = !/Edge\/(\d+)|MSIE \d|Trident\//.exec(navigator.userAgent)

describe("EditorView.movePos", () => {
  it("does the right thing for character motion when focused", () => {
    requireFocus()
    let cm = tempEditor([/*  0 */ "foo bar",
                         /*  8 */ "ao\u030c\u0318a\u030b\u0319x",
                         /* 17 */ "",
                         /* 18 */ "abcتممين"].join("\n"))
    cm.focus()
    for (let [from, to] of [[0, 1], [3, 4], [7, 8], [8, 9], [9, 12], [12, 15], [15, 16], [16, 17], [17, 18]])
      ist(cm.movePos(from, "right", "character"), to)
    for (let [from, to] of [[0, 0], [3, 2], [7, 6], [8, 7], [16, 15], [15, 12], [12, 9], [9, 8]])
      ist(cm.movePos(from, "left", "character"), to)
    if (visualBidi) {
      // Intentionally keeping these somewhat vague (just require all
      // positions to be visited), since Webkit and Firefox differ
      // quite a lot in how they handle bidi span boundaries.
      let pos = 18, visitedLeft = [], visitedRight = [pos]
      for (let i = 0; i < 8; i++)
        visitedRight.push(pos = cm.movePos(pos, "right", "character"))
      visitedLeft.push(pos)
      for (let i = 0; i < 8; i++)
        visitedLeft.push(pos = cm.movePos(pos, "left", "character"))
      for (let i = 19; i < 26; i++) {
        ist(visitedLeft.indexOf(i) > -1)
        ist(visitedRight.indexOf(i) > -1)
      }
    }
  })

  it("does the right thing for character motion when not focused", () => {
    let cm = tempEditor("ao\u030c\u0318a\u030b\u0319x\n\n")
    cm.contentDOM.blur()
    let order = [0, 1, 4, 7, 8, 9, 10]
    for (let i = 0; i < order.length; i++)
      ist(cm.movePos(order[i], "right", "character"), order[Math.min(order.length - 1, i + 1)])
    for (let i = order.length - 1; i >= 0; i--)
      ist(cm.movePos(order[i], "left", "character"), order[Math.max(0, i - 1)])
  })

  function testLineMotion(focus: boolean) {
    let cm = tempEditor("one two\nthree\nتممين")
    if (focus) cm.focus()
    else cm.contentDOM.blur()
    ist(cm.movePos(0, "forward", "line"), 8)
    ist(cm.movePos(1, "forward", "line"), 9)
    ist(cm.movePos(7, "forward", "line"), 13)
    let last = cm.movePos(10, "forward", "line")
    ist(last, 19, "<")
    ist(last, 14, ">")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1))) // Clear goal columns
    ist(cm.movePos(last, "backward", "line"), 10)
    ist(cm.movePos(12, "backward", "line"), 4)
    ist(cm.movePos(13, "backward", "line"), 5)
    ist(cm.movePos(8, "backward", "line"), 0)
  }

  it("properly handles line motion when focused", () => {
    requireFocus()
    testLineMotion(true)
  })

  it("properly handles line motion when not focused", () => {
    testLineMotion(false)
  })

  function testLineBoundaryMotion(focus: boolean) {
    let cm = tempEditor("\none two\n")
    if (focus) cm.focus()
    else cm.contentDOM.blur()
    ist(cm.movePos(1, "left", "lineboundary"), 1)
    ist(cm.movePos(5, "left", "lineboundary"), 1)
    ist(cm.movePos(8, "left", "lineboundary"), 1)
    ist(cm.movePos(1, "right", "lineboundary"), 8)
    ist(cm.movePos(5, "right", "lineboundary"), 8)
    ist(cm.movePos(8, "right", "lineboundary"), 8)
  }

  it("properly handles line-boundary motion when focused", () => {
    requireFocus()
    testLineBoundaryMotion(true)
  })

  it("properly handles line-boundary motion when not focused", () => {
    testLineBoundaryMotion(false)
  })
})
