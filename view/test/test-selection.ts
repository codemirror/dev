import {tempEditor, requireFocus} from "./temp-editor"
import {EditorSelection} from "../../state/src"
import ist from "ist"

function setDOMSel(node: Node, offset: number) {
  let range = document.createRange()
  range.setEnd(node, offset)
  range.setStart(node, offset)
  let sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

describe("EditorView selection", () => {
  it("can read the DOM selection", () => {
    requireFocus()
    let cm = tempEditor("one\n\nthree")

    function test(node: Node, offset: number, expected: number) {
      setDOMSel(node, offset)
      cm.contentDOM.focus()
      cm.docView.observer.readSelection()
      ist(cm.state.selection.primary.head, expected)
    }
    let one = cm.contentDOM.firstChild!.firstChild!
    let three = cm.contentDOM.lastChild!.firstChild!
    test(one, 0, 0)
    test(one, 1, 1)
    test(one, 3, 3)
    test(one.parentNode!, 0, 0)
    test(one.parentNode!, 1, 3)
    test(cm.contentDOM.childNodes[1], 0, 4)
    test(three, 0, 5)
    test(three, 2, 7)
    test(three.parentNode!, 0, 5)
    test(three.parentNode!, 1, 10)
  })

  it("syncs the DOM selection with the editor selection", () => {
    requireFocus()

    let cm = tempEditor("abc\n\ndef")
    function test(pos: number, node: Node, offset: number) {
      cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(pos)))
      ist(window.getSelection()!.focusNode, node)
      ist(window.getSelection()!.focusOffset, offset)
    }
    let abc = cm.contentDOM.firstChild!.firstChild!
    let def = cm.contentDOM.lastChild!.firstChild!
    cm.focus()
    test(0, abc.parentNode!, 0)
    test(1, abc, 1)
    test(2, abc, 2)
    test(3, abc.parentNode!, 1)
    test(4, cm.contentDOM.childNodes[1], 0)
    test(5, def.parentNode!, 0)
    test(6, def, 1)
    test(8, def.parentNode!, 1)
  })
})
