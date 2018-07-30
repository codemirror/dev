import browser from "./browser"
import {domIndex, getRoot, maxOffset, selectionCollapsed} from "./dom"
import {EditorView} from "./editorview"

function isIgnorable(dom: Node): boolean {
  let desc = dom.cmView
  return !!(desc && desc.length == 0 && (dom.nextSibling || dom.nodeName != "BR"))
}

// Make sure the cursor isn't directly after or before one or more
// ignored nodes, which will confuse the browser's cursor motion
// logic.
function skipIgnoredNodes(view: EditorView, dir: -1 | 1) {
  let sel = getRoot(view.contentDOM).getSelection()
  let node = sel.focusNode, offset = sel.focusOffset
  if (!node) return
  let move = false
  if (browser.gecko && node.nodeType == 1) {
    let next = node.childNodes[offset - (dir < 0 ? 0 : 1)]
    if (next && isIgnorable(next)) move = true
  }
  for (let j = 0; ; j++) {
    if (j == 100) throw new Error("NO END")
    if (offset != (dir < 0 ? 0 : maxOffset(node))) {
      if (node.nodeType != 1) break
      let next = node.childNodes[offset - (dir < 0 ? 1 : 0)]
      if (isIgnorable(next)) {
        move = true
        offset += dir
      } else {
        node = next
        offset = dir < 0 ? maxOffset(node) : 0
        if (node.nodeType != 1) break
      }
    } else if (node.nodeName == "DIV" || node.nodeName == "PRE") {
      break
    } else {
      offset = domIndex(node) + (dir < 0 ? 0 : 1)
      node = node.parentNode!
      if (node == view.contentDOM) break
    }
  }
  if (move) setSelFocus(view, node, offset)
}

function setSelFocus(view: EditorView, node: Node, offset: number) {
  let sel = getRoot(view.contentDOM).getSelection()
  view.docView.observer.withoutSelectionListening(() => {
    if (selectionCollapsed(sel)) {
      let range = document.createRange()
      range.setEnd(node, offset)
      range.setStart(node, offset)
      sel.removeAllRanges()
      sel.addRange(range)
    } else if (sel.extend) {
      sel.extend(node, offset)
    }
  })
}

function getMods(event: KeyboardEvent): string {
  let result = ""
  if (event.ctrlKey) result += "c"
  if (event.metaKey) result += "m"
  if (event.altKey) result += "a"
  if (event.shiftKey) result += "s"
  return result
}

export function beforeKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  let code = event.keyCode, mods = getMods(event)
  // Backspace, Left Arrow, Up Arrow, Ctrl-h on Mac
  if (code == 8 || code == 37 || code == 38 || (browser.mac && code == 72 && mods == "c"))
    skipIgnoredNodes(view, -1)
  // Delete, Right Arrow, Down Arrow, Ctrl-d on Mac
  else if (code == 46 || code == 39 || code == 40 || (browser.mac && code == 68 && mods == "c"))
    skipIgnoredNodes(view, 1)
  // Esc, Mod-[biyz]
  else if (code == 27 || (mods == (browser.mac ? "m" : "c") &&
                          (code == 66 || code == 73 || code == 89 || code == 90)))
    return true
  return false
}
