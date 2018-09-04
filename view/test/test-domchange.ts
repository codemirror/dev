import {tempEditor} from "./temp-editor"
import {EditorSelection, Plugin} from "../../state/src"
import {Decoration, EditorView} from "../src"
import ist from "ist"

function flush(cm: EditorView) {
  cm.docView.observer.flush()
}

describe("DOM changes", () => {
  it("notices text changes", () => {
    let cm = tempEditor("foo\nbar")
    cm.domAtPos(1)!.node.nodeValue = "froo"
    flush(cm)
    ist(cm.state.doc.toString(), "froo\nbar")
  })

  it("handles browser enter behavior", () => {
    let cm = tempEditor("foo\nbar"), line0 = cm.domAtPos(0)!.node
    line0.appendChild(document.createElement("br"))
    line0.appendChild(document.createElement("br"))
    flush(cm)
    ist(cm.state.doc.toString(), "foo\n\nbar")
  })

  it("supports deleting lines", () => {
    let cm = tempEditor("1\n2\n3\n4\n5\n6")
    for (let i = 0, lineDOM = cm.domAtPos(0)!.node.parentNode!; i < 4; i++) lineDOM.childNodes[1].remove()
    flush(cm)
    ist(cm.state.doc.toString(), "1\n6")
  })

  it("can deal with large insertions", () => {
    let cm = tempEditor("okay")
    let node = document.createElement("div")
    node.textContent = "ayayayayayay"
    for (let i = 0, lineDOM = cm.domAtPos(0)!.node.parentNode!; i < 100; i++) lineDOM.appendChild(node.cloneNode(true))
    flush(cm)
    ist(cm.state.doc.toString(), "okay" + "\nayayayayayay".repeat(100))
  })

  it("properly handles selection for ambiguous backspace", () => {
    let cm = tempEditor("foo")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(2)))
    cm.domAtPos(1)!.node.nodeValue = "fo"
    cm.inputState.lastKeyCode = 8
    cm.inputState.lastKeyTime = Date.now()
    flush(cm)
    ist(cm.state.selection.primary.anchor, 1)
  })

  it("notices text changes at the end of a long document", () => {
    let cm = tempEditor("foo\nbar\n".repeat(15))
    cm.domAtPos(8*15)!.node.textContent = "a"
    flush(cm)
    ist(cm.state.doc.toString(), "foo\nbar\n".repeat(15) + "a")
  })

  it("handles replacing a selection with a prefix of itself", () => {
    let cm = tempEditor("foo\nbar")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(0, 7)))
    cm.contentDOM.textContent = "f"
    flush(cm)
    ist(cm.state.doc.toString(), "f")
  })

  it("handles replacing a selection with a suffix of itself", () => {
    let cm = tempEditor("foo\nbar")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(0, 7)))
    cm.contentDOM.textContent = "r"
    flush(cm)
    ist(cm.state.doc.toString(), "r")
  })

  it("handles replacing a selection with a prefix of itself and something else", () => {
    let cm = tempEditor("foo\nbar")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(0, 7)))
    cm.contentDOM.textContent = "fa"
    flush(cm)
    ist(cm.state.doc.toString(), "fa")
  })

  it("handles replacing a selection with a suffix of itself and something else", () => {
    let cm = tempEditor("foo\nbar")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(0, 7)))
    cm.contentDOM.textContent = "br"
    flush(cm)
    ist(cm.state.doc.toString(), "br")
  })

  it("handles replacing a selection with new content that shares a prefix and a suffix", () => {
    let cm = tempEditor("foo\nbar")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1, 6)))
    cm.contentDOM.textContent = "fo--ar"
    flush(cm)
    ist(cm.state.doc.toString(), "fo--ar")
  })

  it("handles appending", () => {
    let cm = tempEditor("foo\nbar")
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(7, 7)))
    cm.contentDOM.appendChild(document.createElement("div"))
    flush(cm)
    ist(cm.state.doc.toString(), "foo\nbar\n")
  })

  it("handles deleting the first line and the newline after it", () => {
    let cm = tempEditor("foo\nbar\n\nbaz")
    cm.contentDOM.innerHTML = "bar<div><br></div><div>baz</div>"
    flush(cm)
    ist(cm.state.doc.toString(), "bar\n\nbaz")
  })

  it("handles deleting a line with an empty line after it", () => {
    let cm = tempEditor("foo\nbar\n\nbaz")
    cm.contentDOM.innerHTML = "<div>foo</div><br><div>baz</div>"
    flush(cm)
    ist(cm.state.doc.toString(), "foo\n\nbaz")
  })

  it("doesn't drop collapsed text", () => {
    let cm = tempEditor("abcd", [new Plugin({view: () => ({
      decorations: Decoration.set(Decoration.range(1, 3, {collapsed: true})),
      updateState() { (this as any).decorations = null }
    })})])
    cm.domAtPos(0)!.node.firstChild!.textContent = "x"
    flush(cm)
    ist(cm.state.doc.toString(), "xbcd")
  })
})
