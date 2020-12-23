import browser from "./browser"

export function getSelection(root: DocumentOrShadowRoot): Selection {
  return (root.getSelection ? root.getSelection() : document.getSelection())!
}

// Work around Chrome issue https://bugs.chromium.org/p/chromium/issues/detail?id=447523
// (isCollapsed inappropriately returns true in shadow dom)
export function selectionCollapsed(domSel: Selection) {
  let collapsed = domSel.isCollapsed
  if (collapsed && browser.chrome && domSel.rangeCount && !domSel.getRangeAt(0).collapsed)
    collapsed = false
  return collapsed
}

export function hasSelection(dom: HTMLElement, selection: Selection): boolean {
  if (!selection.anchorNode) return false
  try {
    // Firefox will raise 'permission denied' errors when accessing
    // properties of `sel.anchorNode` when it's in a generated CSS
    // element.
    return dom.contains(selection.anchorNode.nodeType == 3 ? selection.anchorNode.parentNode! : selection.anchorNode)
  } catch(_) {
    return false
  }
}

export function clientRectsFor(dom: Node): DOMRectList {
  if (dom.nodeType == 3) {
    let range = tempRange()
    range.setEnd(dom, dom.nodeValue!.length)
    range.setStart(dom, 0)
    return range.getClientRects() as DOMRectList
  } else if (dom.nodeType == 1) {
    return (dom as HTMLElement).getClientRects() as DOMRectList
  } else {
    return [] as any as DOMRectList
  }
}

// Scans forward and backward through DOM positions equivalent to the
// given one to see if the two are in the same place (i.e. after a
// text node vs at the end of that text node)
export function isEquivalentPosition(node: Node, off: number, targetNode: Node | null, targetOff: number): boolean {
  return targetNode ? (scanFor(node, off, targetNode, targetOff, -1) ||
                       scanFor(node, off, targetNode, targetOff, 1)) : false
}

export function domIndex(node: Node): number {
  for (var index = 0;; index++) {
    node = node.previousSibling!
    if (!node) return index
  }
}

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

export function maxOffset(node: Node): number {
  return node.nodeType == 3 ? node.nodeValue!.length : node.childNodes.length
}

/// Basic rectangle type.
export interface Rect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export function flattenRect(rect: Rect, left: boolean) {
  let x = left ? rect.left : rect.right
  return {left: x, right: x, top: rect.top, bottom: rect.bottom}
}

function windowRect(win: Window): Rect {
  return {left: 0, right: win.innerWidth,
          top: 0, bottom: win.innerHeight}
}

const ScrollSpace = 5

export function scrollRectIntoView(dom: HTMLElement, rect: Rect) {
  let doc = dom.ownerDocument!, win = doc.defaultView!

  for (let cur: any = dom.parentNode; cur;) {
    if (cur.nodeType == 1) { // Element
      let bounding: Rect, top = cur == document.body
      if (top) {
        bounding = windowRect(win)
      } else {
        if (cur.scrollHeight <= cur.clientHeight && cur.scrollWidth <= cur.clientWidth) {
          cur = cur.parentNode
          continue
        }
        let rect = cur.getBoundingClientRect()
        // Make sure scrollbar width isn't included in the rectangle
        bounding = {left: rect.left, right: rect.left + cur.clientWidth,
                    top: rect.top, bottom: rect.top + cur.clientHeight}
      }

      let moveX = 0, moveY = 0
      if (rect.top < bounding.top)
        moveY = -(bounding.top - rect.top + ScrollSpace)
      else if (rect.bottom > bounding.bottom)
        moveY = rect.bottom - bounding.bottom + ScrollSpace
      if (rect.left < bounding.left)
        moveX = -(bounding.left - rect.left + ScrollSpace)
      else if (rect.right > bounding.right)
        moveX = rect.right - bounding.right + ScrollSpace
      if (moveX || moveY) {
        if (top) {
          win.scrollBy(moveX, moveY)
        } else {
          if (moveY) {
            let start = cur.scrollTop
            cur.scrollTop += moveY
            moveY = cur.scrollTop - start
          }
          if (moveX) {
            let start = cur.scrollLeft
            cur.scrollLeft += moveX
            moveX = cur.scrollLeft - start
          }
          rect = {left: rect.left - moveX, top: rect.top - moveY,
                  right: rect.right - moveX, bottom: rect.bottom - moveY} as ClientRect
        }
      }
      if (top) break
      cur = cur.parentNode
    } else if (cur.nodeType == 11) { // A shadow root
      cur = cur.host
    } else {
      break
    }
  }
}

export class DOMSelection {
  anchorNode: Node | null = null
  anchorOffset: number = 0
  focusNode: Node | null = null
  focusOffset: number = 0

  eq(domSel: Selection): boolean {
    return this.anchorNode == domSel.anchorNode && this.anchorOffset == domSel.anchorOffset &&
      this.focusNode == domSel.focusNode && this.focusOffset == domSel.focusOffset
  }

  set(domSel: Selection) {
    this.anchorNode = domSel.anchorNode; this.anchorOffset = domSel.anchorOffset
    this.focusNode = domSel.focusNode; this.focusOffset = domSel.focusOffset
  }
}

let preventScrollSupported: null | false | {preventScroll: boolean} = null
// Feature-detects support for .focus({preventScroll: true}), and uses
// a fallback kludge when not supported.
export function focusPreventScroll(dom: HTMLElement) {
  if ((dom as any).setActive) return (dom as any).setActive() // in IE
  if (preventScrollSupported) return dom.focus(preventScrollSupported)

  let stack = []
  for (let cur: Node | null = dom; cur; cur = cur.parentNode) {
    stack.push(cur, (cur as any).scrollTop, (cur as any).scrollLeft)
    if (cur == cur.ownerDocument) break
  }
  dom.focus(preventScrollSupported == null ? {
    get preventScroll() {
      preventScrollSupported = {preventScroll: true}
      return true
    }
  } : undefined)
  if (!preventScrollSupported) {
    preventScrollSupported = false
    for (let i = 0; i < stack.length;) {
      let elt = stack[i++] as HTMLElement, top = stack[i++] as number, left = stack[i++] as number
      if (elt.scrollTop != top) elt.scrollTop = top
      if (elt.scrollLeft != left) elt.scrollLeft = left
    }
  }
}

let scratchRange: Range | null

export function tempRange() { return scratchRange || (scratchRange = document.createRange()) }
