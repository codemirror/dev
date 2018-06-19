import browser from "./browser"

export let getRoot: (dom: HTMLElement) => Document = typeof document == "undefined" || (document as any).getRootNode
  ? (dom: HTMLElement) => (dom as any).getRootNode()
  : () => document

// Work around Chrome issue https://bugs.chromium.org/p/chromium/issues/detail?id=447523
// (isCollapsed inappropriately returns true in shadow dom)
export function selectionCollapsed(domSel: Selection) {
  let collapsed = domSel.isCollapsed
  if (collapsed && browser.chrome && domSel.rangeCount && !domSel.getRangeAt(0).collapsed)
    collapsed = false
  return collapsed
}

export function hasSelection(dom: HTMLElement): boolean {
  let sel = getRoot(dom).getSelection()
  if (!sel.anchorNode) return false
  try {
    // Firefox will raise 'permission denied' errors when accessing
    // properties of `sel.anchorNode` when it's in a generated CSS
    // element.
    return dom.contains(sel.anchorNode.nodeType == 3 ? sel.anchorNode.parentNode! : sel.anchorNode)
  } catch(_) {
    return false
  }
}

export function clientRectsFor(dom: Node): DOMRectList {
  if (dom.nodeType == 3) {
    let range = document.createRange()
    range.setEnd(dom, dom.nodeValue!.length)
    range.setStart(dom, 0)
    return range.getClientRects() as DOMRectList
  } else if (dom.nodeType == 3) {
    return (dom as HTMLElement).getClientRects() as DOMRectList
  } else {
    return [] as any as DOMRectList
  }
}
