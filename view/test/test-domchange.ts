import {tempEditor} from "./temp-editor"
import ist from "ist"

describe("DOM changes", () => {
  it("notices text changes", () => {
    let cm = tempEditor("foo\nbar")
    cm.contentDOM.firstChild.firstChild.nodeValue = "froo"
    cm.domObserver.flush()
    ist(cm.state.doc.text, "froo\nbar")
  })

  it("handles browser enter behavior", () => {
    let cm = tempEditor("foo\nbar")
    cm.contentDOM.firstChild.appendChild(document.createElement("br"))
    cm.contentDOM.firstChild.appendChild(document.createElement("br"))
    cm.domObserver.flush()
    ist(cm.state.doc.text, "foo\n\nbar")
  })

  it("supports deleting lines", () => {
    let cm = tempEditor("1\n2\n3\n4\n5\n6")
    for (let i = 0; i < 4; i++) cm.contentDOM.childNodes[1].remove()
    cm.domObserver.flush()
    ist(cm.state.doc.text, "1\n6")
  })

  it("can deal with large insertions", () => {
    let cm = tempEditor("okay")
    let node = document.createElement("div")
    node.textContent = "ayayayayayay"
    for (let i = 0; i < 100; i++) cm.contentDOM.appendChild(node.cloneNode(true))
    cm.domObserver.flush()
    ist(cm.state.doc.text, "okay" + "\nayayayayayay".repeat(100))
  })
})
