import {tempEditor} from "./temp-editor"
import ist from "ist"

describe("EditorView coords", () => {
  it("can find coordinates for simple text", () => {
    let cm = tempEditor("one two\nthree"), prev = null
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsAtPos(i)!
      if (prev) ist(prev.top < coords.top - 5 || prev.left < coords.left)
      prev = coords
      ist(cm.posAtCoords({x: coords.left, y: coords.top}), i)
    }
  })

  it("can find coordinates in text scrolled into view horizontally", () => {
    let cm = tempEditor("l1\n" + "l2 ".repeat(400))
    let rect = cm.dom.getBoundingClientRect(), line2 = cm.coordsAtPos(3)!.top + 2
    cm.scrollDOM.scrollLeft = 0
    let right = cm.posAtCoords({x: rect.right - 2, y: line2})
    cm.scrollDOM.scrollLeft = (rect.right - rect.left) - 10
    ist(cm.posAtCoords({x: rect.right - 2, y: line2}), right, ">")
  })
})
