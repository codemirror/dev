import {EditorView} from "./editorview"
import {getRoot} from "./dom"
import {EditorSelection} from "../../state/src"

export function applyDOMChange(view: EditorView, start: number, end: number) {
  let bounds = view.docView.domBoundsAround(start, end, 0)
  if (!bounds) { view.setState(view.state); return }
  let {from, to} = bounds
  let selPoints = selectionPoints(view.contentDOM), reader = new DOMReader(selPoints)
  reader.readRange(bounds.startDOM, bounds.endDOM)
  let newSelection = selectionFromPoints(selPoints, from)
  
  let preferredPos = view.state.selection.primary.from, preferredSide = null
  // Prefer anchoring to end when Backspace is pressed
  if (view.inputState.lastKeyCode === 8 && view.inputState.lastKeyTime > Date.now() - 100) {
    preferredPos = view.state.selection.primary.to
    preferredSide = "end"
  }
  view.inputState.lastKeyCode = 0

  let diff = findDiff(view.state.doc.slice(from, to), reader.text, preferredPos - from, preferredSide)
  if (diff) {
    let start = from + diff.from, end = from + diff.toA
    let tr = view.state.transaction, inserted = reader.text.slice(diff.from, diff.toB)
    if (start >= tr.selection.primary.from && end <= tr.selection.primary.to)
      tr = tr.replaceSelection(inserted)
    else
      tr = tr.replace(start, end, inserted)
    if (newSelection && !tr.selection.primary.eq(newSelection.primary))
      tr = tr.setSelection(newSelection)
    // FIXME maybe also try to detect (Android) enter here and call
    // the key handler
    view.dispatch(tr)
  } else if (newSelection && !newSelection.eq(view.state.selection)) {
    view.dispatch(view.state.transaction.setSelection(newSelection))
  } else {
    view.setState(view.state)
  }
}

function findDiff(a: string, b: string, preferredPos: number, preferredSide: string | null)
    : {from: number, toA: number, toB: number} | null {
  let minLen = Math.min(a.length, b.length)
  let from = 0
  while (from < minLen && a.charCodeAt(from) == b.charCodeAt(from)) from++
  if (from == minLen && a.length == b.length) return null
  let toA = a.length, toB = b.length
  while (toA > 0 && toB > 0 && a.charCodeAt(toA - 1) == b.charCodeAt(toB - 1)) { toA--; toB-- }

  if (preferredSide == "end") {
    let adjust = Math.max(0, from - Math.min(toA, toB))
    preferredPos -= toA + adjust - from
  }
  if (toA < from && a.length < b.length) {
    let move = preferredPos <= from && preferredPos >= toA ? from - preferredPos : 0
    from -= move
    toB = from + (toB - toA)
    toA = from
  } else if (toB < from) {
    let move = preferredPos <= from && preferredPos >= toB ? from - preferredPos : 0
    from -= move
    toA = from + (toA - toB)
    toB = from
  }
  return {from, toA, toB}
}

class DOMReader {
  text: string = ""
  constructor(private points: DOMPoint[]) {}

  readRange(start: Node | null, end: Node | null) {
    if (!start) return
    let parent = start.parentNode!
    for (let cur = start!;;) {
      this.findPointBefore(parent, cur)
      this.readNode(cur)
      let next: Node | null = cur.nextSibling
      if (next == end) break
      if (isBlockNode(cur)) this.text += "\n"
      cur = next!
    }
    this.findPointBefore(parent, end)
  }

  readNode(node: Node) {
    if (node.cmIgnore) return
    let view = node.cmView
    let fromView = view && view.overrideDOMText
    let text: string | undefined
    if (fromView != null) text = fromView
    else if (node.nodeType == 3) text = node.nodeValue!
    else if (node.nodeName == "BR") text = node.nextSibling ? "\n" : ""
    else if (node.nodeType == 1) this.readRange(node.firstChild, null)
    if (text != null) {
      this.findPointIn(node, text.length)
      this.text += text
    }
  }

  findPointBefore(node: Node, next: Node | null) {
    for (let point of this.points)
      if (point.node == node && node.childNodes[point.offset] == next)
        point.pos = this.text.length
  }

  findPointIn(node: Node, maxLen: number) {
    for (let point of this.points)
      if (point.node == node)
        point.pos = this.text.length + Math.min(point.offset, maxLen)
  }
}

function isBlockNode(node: Node): boolean {
  return node.nodeType == 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|DD|DT|H\d|SECTION|PRE)$/.test(node.nodeName)
}

class DOMPoint {
  pos: number = -1
  constructor(readonly node: Node, readonly offset: number) {}
}

function selectionPoints(dom: HTMLElement): DOMPoint[] {
  let root = getRoot(dom), result = []
  if (root.activeElement != dom) return result
  let {anchorNode, anchorOffset, focusNode, focusOffset} = root.getSelection()
  if (anchorNode) {
    result.push(new DOMPoint(anchorNode, anchorOffset))
    if (focusNode != anchorNode || focusOffset != anchorOffset)
      result.push(new DOMPoint(focusNode, focusOffset))
  }
  return result
}

function selectionFromPoints(points: DOMPoint[], base: number): EditorSelection | null {
  if (points.length == 0) return null
  let anchor = points[0].pos, head = points.length == 2 ? points[1].pos : anchor
  return anchor > -1 && head > -1 ? EditorSelection.single(anchor + base, head + base) : null
}
