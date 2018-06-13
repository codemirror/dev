import {tempEditor} from "./temp-editor"
import {Selection} from "../../state/src/state"
import ist from "ist"

function flush(cm) {
  cm.docView.observer.flush()
}

describe("DOM changes", () => {
  it("notices text changes", () => {
    let cm = tempEditor("foo\nbar")
    cm.domAtPos(1).node.nodeValue = "froo"
    flush(cm)
    ist(cm.state.doc.text, "froo\nbar")
  })

  it("handles browser enter behavior", () => {
    let cm = tempEditor("foo\nbar"), line0 = cm.domAtPos(0).node
    line0.appendChild(document.createElement("br"))
    line0.appendChild(document.createElement("br"))
    flush(cm)
    ist(cm.state.doc.text, "foo\n\nbar")
  })

  it("supports deleting lines", () => {
    let cm = tempEditor("1\n2\n3\n4\n5\n6")
    for (let i = 0, lineDOM = cm.domAtPos(0).node.parentNode; i < 4; i++) lineDOM.childNodes[1].remove()
    flush(cm)
    ist(cm.state.doc.text, "1\n6")
  })

  it("can deal with large insertions", () => {
    let cm = tempEditor("okay")
    let node = document.createElement("div")
    node.textContent = "ayayayayayay"
    for (let i = 0, lineDOM = cm.domAtPos(0).node.parentNode; i < 100; i++) lineDOM.appendChild(node.cloneNode(true))
    flush(cm)
    ist(cm.state.doc.text, "okay" + "\nayayayayayay".repeat(100))
  })

  it("properly handles selection for ambiguous backspace", () => {
    let cm = tempEditor("foo")
    cm.dispatch(cm.state.transaction.setSelection(Selection.single(2)))
    cm.domAtPos(1).node.nodeValue = "fo"
    cm.inputState.lastKeyCode = 8
    cm.inputState.lastKeyTime = Date.now()
    flush(cm)
    ist(cm.state.selection.primary.anchor, 1)
  })
})
