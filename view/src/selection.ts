import {EditorView} from "./view"
import {Selection as EditorSelection, MetaSlot, Range} from "../../state/src/state"
import browser from "./browser"

export class SelectionReader {
  lastAnchorNode: Node | null = null;
  lastHeadNode: Node | null = null;
  lastAnchorOffset: number = -1;
  lastHeadOffset: number = -1;

  lastSelection: EditorSelection | null = null;

  listening: boolean = false;
  origin: string | null = null;
  originTime: number = 0;

  ignoreUpdates: boolean = false;

  constructor(public view: EditorView) {
    this.read = this.read.bind(this)

    view.contentDOM.addEventListener("focus", () => {
      this.start()
      if (hasSelection(this.view)) this.read()
    })
    view.contentDOM.addEventListener("blur", () => this.stop())
  }

  start() {
    if (!this.listening) {
      let doc = this.view.dom.ownerDocument
      doc.addEventListener("selectionchange", this.read)
      this.listening = true
    }
  }

  stop() {
    if (this.listening) {
      let doc = this.view.dom.ownerDocument
      doc.removeEventListener("selectionchange", this.read)
      this.listening = false
    }
  }

  destroy() { this.stop() }

  setOrigin(origin: string) {
    this.origin = origin
    this.originTime = Date.now()
  }

  // : () → bool
  // Whether the DOM selection has changed from the last known state.
  domChanged() {
    let sel = this.view.root.getSelection()
    return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
      sel.focusNode != this.lastHeadNode || sel.focusOffset != this.lastHeadOffset
  }

  // Store the current state of the DOM selection.
  storeDOMState(selection: EditorSelection) {
    let sel = this.view.root.getSelection()
    this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset
    this.lastHeadNode = sel.focusNode; this.lastHeadOffset = sel.focusOffset
    this.lastSelection = selection
  }

  clearDOMState() {
    this.lastAnchorNode = this.lastSelection = null
  }

  read() {
    if (this.ignoreUpdates || !this.domChanged() || !this.view.hasFocus() || !hasSelection(this.view)) return
    this.view.domObserver.flush()

    let domSel = this.view.root.getSelection()
    let head = this.view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset)
    let anchor = selectionCollapsed(domSel) ? head : this.view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset)

    let selection = new EditorSelection([new Range(anchor, head)])
    this.storeDOMState(selection)
    if (!this.view.state.selection.eq(selection)) {
      let tr = this.view.state.transaction.setSelection(selection)
      if (this.originTime > Date.now() - 50) tr = tr.setMeta(MetaSlot.origin, this.origin)
      this.view.dispatch(tr)
    }
    this.origin = null
  }
}

function hasSelection(view: EditorView): boolean {
  let sel = view.root.getSelection()
  if (!sel.anchorNode) return false
  try {
    // Firefox will raise 'permission denied' errors when accessing
    // properties of `sel.anchorNode` when it's in a generated CSS
    // element.
    return view.contentDOM.contains(sel.anchorNode.nodeType == 3 ? sel.anchorNode.parentNode! : sel.anchorNode)
  } catch(_) {
    return false
  }
}

// Work around Chrome issue https://bugs.chromium.org/p/chromium/issues/detail?id=447523
// (isCollapsed inappropriately returns true in shadow dom)
function selectionCollapsed(domSel: Selection) {
  let collapsed = domSel.isCollapsed
  if (collapsed && browser.chrome && domSel.rangeCount && !domSel.getRangeAt(0).collapsed)
    collapsed = false
  return collapsed
}

export function selectionToDOM(view: EditorView, takeFocus: boolean = false) {
  let sel = view.state.selection

  if (!view.hasFocus() && !takeFocus) return

  let reader = view.selectionReader
  if (reader.lastSelection && reader.lastSelection.eq(sel) && !reader.domChanged()) return

  reader.ignoreUpdates = true
  let anchor = view.docView.domFromPos(sel.primary.anchor)
  let head = view.docView.domFromPos(sel.primary.head)

  let domSel = view.root.getSelection(), range = document.createRange()
  // Selection.extend can be used to create an 'inverted' selection
  // (one where the focus is before the anchor), but not all
  // browsers support it yet.
  if (domSel.extend) {
    range.setEnd(anchor.node, anchor.offset)
    range.collapse(false)
  } else {
    if (anchor > head) [anchor, head] = [head, anchor]
    range.setEnd(head.node, head.offset)
    range.setStart(anchor.node, anchor.offset)
  }
  domSel.removeAllRanges()
  domSel.addRange(range)
  if (domSel.extend) domSel.extend(head.node, head.offset)

  reader.storeDOMState(sel)
  reader.ignoreUpdates = false
}
