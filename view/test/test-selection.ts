import {tempEditor, requireFocus} from "./temp-editor"
import {EditorSelection} from "../../state"
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
    let cm = requireFocus(tempEditor("one\n\nthree"))

    function test(node: Node, offset: number, expected: number) {
      setDOMSel(node, offset)
      cm.contentDOM.focus()
      cm.docView.observer.flush()
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
    let cm = requireFocus(tempEditor("abc\n\ndef"))
    function test(pos: number, node: Node, offset: number) {
      cm.dispatch(cm.state.t().setSelection(EditorSelection.single(pos)))
      let sel = window.getSelection()!
      ist(isEquivalentPosition(node, offset, sel.focusNode, sel.focusOffset))
    }
    let abc = cm.contentDOM.firstChild!.firstChild!
    let def = cm.contentDOM.lastChild!.firstChild!
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

function isEquivalentPosition(node: Node, off: number, targetNode: Node | null, targetOff: number): boolean {
  function scanFor(node: Node, off: number, targetNode: Node, targetOff: number, dir: -1 | 1): boolean {
    for (;;) {
      if (node == targetNode && off == targetOff) return true
      if (off == (dir < 0 ? 0 : maxOffset(node))) {
        if (node.nodeName == "DIV") return false
        let parent = node.parentNode
        if (!parent || parent.nodeType != 1) return false
        off = domIndex(node) + (dir < 0 ? 0 : 1)
        node = parent
      } else if (node.nodeType == 1) {
        node = node.childNodes[off + (dir < 0 ? -1 : 0)]
        off = dir < 0 ? maxOffset(node) : 0
      } else {
        return false
      }
    }
  }

  function domIndex(node: Node): number {
    for (var index = 0;; index++) {
      node = node.previousSibling!
      if (!node) return index
    }
  }

  function maxOffset(node: Node): number {
    return node.nodeType == 3 ? node.nodeValue!.length : node.childNodes.length
  }

  return targetNode ? (scanFor(node, off, targetNode, targetOff, -1) ||
                       scanFor(node, off, targetNode, targetOff, 1)) : false
}
