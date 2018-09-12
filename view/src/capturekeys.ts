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
    if (selectionCollapsed(sel)) sel.collapse(node, offset)
    else if (sel.extend) sel.extend(node, offset)
  })
}

const enum mod { ctrl = 1, alt = 2, shift = 4, meta = 8 }

function getMods(event: KeyboardEvent): number {
  return (event.ctrlKey ? mod.ctrl : 0) | (event.metaKey ? mod.meta : 0) |
    (event.altKey ? mod.alt : 0) | (event.shiftKey ? mod.shift : 0)
}

// FIXME this isn't valid in RTL, in fact, we're skipping the wrong way there
export function beforeKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  let code = event.keyCode, mods = getMods(event), macCtrl = browser.mac && mods == mod.ctrl
  if (code == 8 || (macCtrl && code == 72) ||  // Backspace, Ctrl-h on Mac
      code == 37 || (macCtrl && code == 66) || // Left Arrow, Ctrl-b on Mac
      code == 38 || (macCtrl && code == 80)) { // Up Arrow, Ctrl-p on Mac
    skipIgnoredNodes(view, -1)
  } else if (code == 46 || (macCtrl && code == 68) || // Delete, Ctrl-d on Mac
             code == 39 || (macCtrl && code == 70) || // Right Arrow, Ctrl-f on Mac
             code == 40 || (macCtrl && code == 78)) { // Down Arrow, Ctrl-n on Mac
    skipIgnoredNodes(view, 1)
  } else if (code == 27 || (mods == (browser.mac ? mod.meta : mod.ctrl) &&
                            (code == 66 || code == 73 || code == 89 || code == 90))) {
    return true
  }
  return false
}
