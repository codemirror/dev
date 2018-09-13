import {EditorView} from "./editorview"
import {getRoot} from "./dom"

function isInViewport(view: EditorView, pos: number): boolean {
  let line = view.docView.lineAround(pos)
  if (!line) return false
  for (let {from, to} of view.docView.viewports)
    if (from > 0 && from == line.start ||
        to < view.state.doc.length && to == line.start + line.line.length)
      return false
  return true
}

declare global {
  interface Selection { modify(action: string, direction: string, granularity: string): void }
}
  
export function findPosH(view: EditorView, start: number,
                         direction: "forward" | "backward" | "left" | "right",
                         granularity: "character" | "word" | "line" = "character",
                         leave: "move" | "extend" | null = null): number {
  let sel = getRoot(view.contentDOM).getSelection()
  if (sel.modify && isInViewport(view, start)) {
    // FIXME if not already there
    let startDOM = view.docView.domFromPos(start)! // FIXME handle when in collapsed?
    return view.docView.observer.withoutSelectionListening(() => {
      sel.collapse(startDOM.node, startDOM.offset)
      sel.modify(leave || "move", direction, granularity)
      // FIXME cleanup
      return view.docView.posFromDOM(sel.focusNode, sel.focusOffset)
    })
  } else if (granularity == "character") {
    // FIXME take collapsed regions and extending chars into account
    return Math.max(0, Math.min(view.state.doc.length, start + (direction == "forward" || direction == "right" ? 1 : -1)))
  } else {
    throw new RangeError("FIXME")
  }
}
