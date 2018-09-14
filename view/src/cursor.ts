import {EditorView} from "./editorview"
import {LineView} from "./lineview"
import {getRoot, isEquivalentPosition, clientRectsFor} from "./dom"
import browser from "./browser"

declare global {
  interface Selection { modify(action: string, direction: string, granularity: string): void }
  interface Document { caretPositionFromPoint(x: number, y: number): {offsetNode: Node, offset: number} }
}

function nearViewportEnd(view: EditorView, context: {line: LineView, start: number}, side: number = 0): boolean {
  for (let {from, to} of view.docView.viewports)
    if (from > 0 && from == context.start && side <= 0 ||
        to < view.state.doc.length && to == context.start + context.line.length && side >= 0)
      return true
  return false
}

export function movePos(view: EditorView, start: number,
                        direction: "forward" | "backward" | "left" | "right",
                        granularity: "character" | "word" | "line" | "lineboundary" = "character",
                        action: "move" | "extend"): number {
  let sel = getRoot(view.contentDOM).getSelection()
  let context = view.docView.lineAround(start)
  let dir = direction == "forward" || direction == "right" ? 1 : -1
  // Can only query native behavior when Selection.modify is
  // supported, the cursor is well inside the rendered viewport, and
  // we're not doing by-line motion on Gecko (which will mess up goal
  // column motion)
  if (sel.modify && context && !nearViewportEnd(view, context) && !(browser.gecko && granularity == "line")) {
    // FIXME work around unwanted DOM behavior (captureKeys + FF widget issues)
    // FIXME firefox is dumb about goal columns when moving by line like this
    let startDOM = view.docView.domFromPos(start)!
    return view.docView.observer.withoutSelectionListening(() => {
      let equiv = isEquivalentPosition(startDOM.node, startDOM.offset, sel.focusNode, sel.focusOffset)
      if (action == "move" && !(equiv && sel.isCollapsed)) sel.collapse(startDOM.node, startDOM.offset)
      else if (action == "extend" && !equiv) sel.extend(startDOM.node, startDOM.offset)
      sel.modify(action, direction, granularity)
      view.docView.setSelectionDirty()
      return view.docView.posFromDOM(sel.focusNode, sel.focusOffset)
    })
  } else if (granularity == "character") {
    // FIXME take collapsed regions and extending chars into account
    return Math.max(0, Math.min(view.state.doc.length, start + dir))
  } else if (granularity == "lineboundary") {
    if (context) return context.start + (dir < 0 ? 0 : context.line.length)
    return dir < 0 ? view.state.doc.lineStartAt(start) : view.state.doc.lineEndAt(start)
  } else if (granularity == "line") {
    if (context && !nearViewportEnd(view, context, dir)) {
      // FIXME goal column
      let startCoords = view.docView.coordsAt(start)!
      let goal = getGoalColumn(view, start, startCoords.left)
      // FIXME skip between-line widgets when implemented
      for (let startY = dir < 0 ? startCoords.top : startCoords.bottom, dist = 5; dist < 50; dist += 10) {
        let pos = posAtCoords(view, {x: goal.column, y: startY + dist * dir})
        if (pos < 0) break
        if (pos != start) {
          goal.pos = pos
          return pos
        }
      }
    }
    // Can't do a precise one based on DOM positions, fall back to per-column
    let lineStart = view.state.doc.lineStartAt(start)
    // FIXME also needs goal column?
    let col = countColumn(view.state.doc.slice(lineStart, start)[0], view.state.tabSize)
    if (dir < 0) {
      if (lineStart == 0) return 0
      let prevLine = view.state.doc.lineStartAt(lineStart - 1)
      return prevLine + findColumn(view.state.doc.slice(prevLine, lineStart - 1)[0], col, view.state.tabSize)
    } else {
      let lineEnd = view.state.doc.lineEndAt(start)
      if (lineEnd == view.state.doc.length) return lineEnd
      let nextLine = view.state.doc.slice(lineEnd + 1, view.state.doc.lineEndAt(lineEnd + 1))[0]
      return lineEnd + 1 + findColumn(nextLine, col, view.state.tabSize)
    }
  } else if (granularity == "word") {
    throw new RangeError("FIXME")
  } else {
    throw new RangeError("Invalid move granularity: " + granularity)
  }
}

function countColumn(string: string, tabSize: number): number {
  let n = 0
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (code == 9) n += tabSize - (n % tabSize)
    else if (code < 0xdc00 || code >= 0xe000) n++
  }
  return n
}

function findColumn(string: string, col: number, tabSize: number): number {
  let n = 0
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i)
    if (code >= 0xdc00 && code < 0xe000) continue
    if (n >= col) return i
    n += code == 9 ? tabSize - (n % tabSize) : 1
  }
  return string.length
}

function getGoalColumn(view: EditorView, pos: number, column: number): {pos: number, column: number} {
  for (let goal of view.inputState.goalColumns)
    if (goal.pos == pos) return goal
  let goal = {pos: 0, column}
  view.inputState.goalColumns.push(goal)
  return goal
}

// Search the DOM for the {node, offset} position closest to the given
// coordinates. Very inefficient and crude, but can usually be avoided
// by calling caret(Position|Range)FromPoint instead.

// FIXME holding arrow-up/down at the end of the viewport is a rather
// common use case that will repeatedly trigger this code. Maybe
// introduce some element of binary search after all?

function domPosAtCoords(parent: HTMLElement, x: number, y: number): {node: Node, offset: number} {
  let closest, dxClosest = 2e8, xClosest!: number, offset = 0
  let rowBot = y, rowTop = y
  for (let child = parent.firstChild, childIndex = 0; child; child = child.nextSibling, childIndex++) {
    let rects = clientRectsFor(child)
    for (let i = 0; i < rects.length; i++) {
      let rect = rects[i]
      if (rect.top <= rowBot && rect.bottom >= rowTop) {
        rowBot = Math.max(rect.bottom, rowBot)
        rowTop = Math.min(rect.top, rowTop)
        let dx = rect.left > x ? rect.left - x
            : rect.right < x ? x - rect.right : 0
        if (dx < dxClosest) {
          closest = child
          dxClosest = dx
          xClosest = dx == 0 ? x : rect.left > x ? rect.left : rect.right
          if (child.nodeType == 1 && dx)
            offset = childIndex + (x >= (rect.left + rect.right) / 2 ? 1 : 0)
          continue
        }
      }
      if (!closest && (x >= rect.right && y >= rect.top ||
                       x >= rect.left && y >= rect.bottom))
        offset = childIndex + 1
    }
  }
  if (closest && closest.nodeType == 3) return domPosInText(closest as Text, xClosest, y)
  if (!closest || (dxClosest && closest.nodeType == 1)) return {node: parent, offset}
  return domPosAtCoords(closest as HTMLElement, xClosest, y)
}

function domPosInText(node: Text, x: number, y: number): {node: Node, offset: number} {
  let len = node.nodeValue!.length, range = document.createRange()
  for (let i = 0; i < len; i++) {
    range.setEnd(node, i + 1)
    range.setStart(node, i)
    let rects = range.getClientRects()
    for (let j = 0; j < rects.length; j++) {
      let rect = rects[j]
      if (rect.top == rect.bottom) continue
      if (rect.left - 1 <= x && rect.right + 1 >= x &&
          rect.top - 1 <= y && rect.bottom + 1 >= y)
        return {node, offset: i + (x >= (rect.left + rect.right) / 2 ? 1 : 0)}
    }
  }
  return {node, offset: 0}
}

export function posAtCoords(view: EditorView, {x, y}: {x: number, y: number}): number {
  let content = view.contentDOM.getBoundingClientRect()
  let lineStart = view.docView.posAtHeight(y - content.top, -1)
  // If this is outside of the rendered viewport, we can't determine a position 
  if (lineStart < view.viewport.from)
    return view.viewport.from == 0 ? 0 : -1 // FIXME lineStart(0) to account for bidi?
  if (lineStart > view.viewport.to)
    return view.viewport.to == view.state.doc.length ? view.state.doc.length : -1
  // Clip x to the viewport sides
  x = Math.max(content.left + 1, Math.min(content.right - 1, x))
  let root = getRoot(view.contentDOM), element = root.elementFromPoint(x, y)

  // There's visible editor content under the point, so we can try
  // using caret(Position|Range)FromPoint as a shortcut
  // FIXME this also suffers from the browser's bad cursor decisions around widgets
  let node: Node | undefined, offset: number = -1
  if (element && view.contentDOM.contains(element) && false) {
    if (root.caretPositionFromPoint) {
      let pos = root.caretPositionFromPoint(x, y)
      if (pos) ({offsetNode: node, offset} = pos)
    } else if (root.caretRangeFromPoint) {
      let range = root.caretRangeFromPoint(x, y)
      if (range) ({startContainer: node, startOffset: offset} = range)
    }
  }

  // No luck, do our own (potentially expensive) expensive search
  if (!node) {
    let {line} = view.docView.lineAround(lineStart)!
    ;({node, offset} = domPosAtCoords(line.dom, x, y))
  }
  return view.docView.posFromDOM(node, offset)
}
