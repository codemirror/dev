import {tempEditor, requireFocus} from "./temp-editor"
import {EditorSelection, Plugin} from "../../state/src"
import {Decoration, WidgetType, EditorView} from "../src"
import ist from "ist"

const visualBidi = !/Edge\/(\d+)|MSIE \d|Trident\//.exec(navigator.userAgent)

class OWidget extends WidgetType<void> {
  toDOM() {
    let node = document.createElement("span")
    node.textContent = "ø"
    return node
  }
}

const oWidgets = new Plugin({
  view: (view: EditorView) => {
    let doc = view.state.doc.toString(), deco = []
    for (let i = 0; i < doc.length; i++) if (doc.charAt(i) == "o")
      deco.push(Decoration.range(i, i + 1, {collapsed: new OWidget(undefined)}))
    return {decorations: Decoration.set(deco)}
  }
})

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

  it("can move through widgets by character when focused", () => {
    requireFocus()
    let cm = tempEditor("o, foo, do", [oWidgets]), len = cm.state.doc.length
    cm.focus()
    for (let i = 0; i <= len; i++)
      ist(cm.movePos(i, "right", "character"), Math.min(i + 1, len))
    for (let i = len; i >= 0; i--)
      ist(cm.movePos(i, "left", "character"), Math.max(0, i - 1))
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

  it("can handle line motion around widgets when not focused", () => {
    let cm = tempEditor("hey\nooh\naah", [oWidgets])
    cm.contentDOM.blur()
    ist(cm.movePos(0, "forward", "line"), 4)
    ist(cm.movePos(1, "forward", "line"), 5)
    ist(cm.movePos(2, "forward", "line"), 6)
    ist(cm.movePos(8, "backward", "line"), 4)
    ist(cm.movePos(9, "backward", "line"), 5)
    ist(cm.movePos(10, "backward", "line"), 6)
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
