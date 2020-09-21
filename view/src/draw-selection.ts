import {EditorSelection, SelectionRange, Extension, Facet, combineConfig} from "@codemirror/next/state"
import {Line} from "@codemirror/next/text"
import {ViewPlugin, ViewUpdate} from "./extension"
import {EditorView} from "./editorview"
import {themeClass} from "./theme"
import {Direction} from "./bidi"
import {Rect} from "./dom"
import browser from "./browser"

const CanHidePrimary = !browser.ios // FIXME test IE, Android

type SelectionConfig = {
  /// The length of a full cursor blink cycle, in milliseconds.
  /// Defaults to 1200. Can be set to 0 to disable blinking.
  cursorBlinkRate?: number
  /// Whether to show a the cursor for non-empty ranges. Defaults to
  /// true.
  drawRangeCursor?: boolean
}

const selectionConfig = Facet.define<SelectionConfig, Required<SelectionConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      cursorBlinkRate: 1200,
      drawRangeCursor: true
    }, {
      cursorBlinkRate: (a, b) => Math.min(a, b),
      drawRangeCursor: (a, b) => a || b
    })
  }
})

export function drawSelection(config: SelectionConfig = {}): Extension {
  return [
    selectionConfig.of(config),
    drawSelectionPlugin,
    hideNativeSelection
  ]
}

type Measure = {rangePieces: Piece[], cursors: Piece[]}

class Piece {
  constructor(readonly left: number, readonly top: number,
              readonly width: number, readonly height: number,
              readonly className: string) {}

  draw() {
    let elt = document.createElement("div")
    elt.className = this.className
    elt.style.left = this.left + "px"
    elt.style.top = this.top + "px"
    if (this.width >= 0) elt.style.width = this.width + "px"
    elt.style.height = this.height + "px"
    return elt
  }

  eq(p: Piece) {
    return this.left == p.left && this.top == p.top && this.width == p.width && this.height == p.height &&
      this.className == p.className
  }
}

const drawSelectionPlugin = ViewPlugin.fromClass(class {
  rangePieces: readonly Piece[] = []
  cursors: readonly Piece[] = []
  measureReq: {read: () => Measure, write: (value: Measure) => void}
  selectionLayer: HTMLElement
  cursorLayer: HTMLElement

  constructor(readonly view: EditorView) {
    this.measureReq = {read: this.readPos.bind(this), write: this.drawSel.bind(this)}
    this.selectionLayer = view.scrollDOM.appendChild(document.createElement("div"))
    this.selectionLayer.className = themeClass("selectionLayer")
    this.selectionLayer.setAttribute("aria-hidden", "true")
    this.cursorLayer = view.scrollDOM.appendChild(document.createElement("div"))
    this.cursorLayer.className = themeClass("cursorLayer")
    this.cursorLayer.setAttribute("aria-hidden", "true")
    view.requestMeasure(this.measureReq)
    this.setBlinkRate()
  }

  setBlinkRate() {
    this.cursorLayer.style.animationDuration = this.view.state.facet(selectionConfig).cursorBlinkRate + "ms"
  }

  update(update: ViewUpdate) {
    let confChanged = update.prevState.facet(selectionConfig) != update.state.facet(selectionConfig)
    if (confChanged || update.selectionSet || update.geometryChanged || update.viewportChanged)
      this.view.requestMeasure(this.measureReq)
    if (update.transactions.some(tr => tr.scrollIntoView))
      this.cursorLayer.style.animationName = this.cursorLayer.style.animationName == "cm-blink" ? "cm-blink2" : "cm-blink"
    if (confChanged) this.setBlinkRate()
  }

  readPos(): Measure {
    let {state} = this.view, conf = state.facet(selectionConfig)
    let rangePieces = state.selection.ranges.map(r => r.empty ? [] : measureRange(this.view, r)).reduce((a, b) => a.concat(b))
    let cursors = []
    for (let r of state.selection.ranges) {
      let prim = r == state.selection.primary
      if (r.empty ? !prim || CanHidePrimary : conf.drawRangeCursor) {
        let piece = measureCursor(this.view, r, prim)
        if (piece) cursors.push(piece)
      }
    }
    return {rangePieces, cursors}
  }

  drawSel({rangePieces, cursors}: Measure) {
    if (rangePieces.length != this.rangePieces.length || rangePieces.some((p, i) => !p.eq(this.rangePieces[i]))) {
      this.selectionLayer.textContent = ""
      for (let p of rangePieces) this.selectionLayer.appendChild(p.draw())
      this.rangePieces = rangePieces
    }
    if (cursors.length != this.cursors.length || cursors.some((c, i) => !c.eq(this.cursors[i]))) {
      this.cursorLayer.textContent = ""
      for (let c of cursors) this.cursorLayer.appendChild(c.draw())
      this.cursors = cursors
    }
  }

  destroy() {
    this.selectionLayer.remove()
    this.cursorLayer.remove()
  }
})

const hideNativeSelection = EditorView.theme({
  $content: {
    caretColor: "transparent !important",
    "& ::selection": {backgroundColor: "transparent !important"}
  }
})

function cmpCoords(a: Rect, b: Rect) {
  return a.top - b.top || a.left - b.left
}

const selectionClass = themeClass("selectionBackground")

function measureRange(view: EditorView, range: SelectionRange): Piece[] {
  let pieces: Piece[] = []
  let ltr = view.textDirection == Direction.LTR
  let content = view.contentDOM, contentRect = content.getBoundingClientRect(), base = view.scrollDOM.getBoundingClientRect()
  let lineStyle = window.getComputedStyle(content.firstChild as HTMLElement)
  let leftSide = contentRect.left + parseInt(lineStyle.paddingLeft)
  let rightSide = contentRect.right - parseInt(lineStyle.paddingRight)

  function add(left: number, top: number, width: number | null, bottom: number) {
    top = Math.round(Math.max(0, top)) - base.top
    bottom = Math.round(bottom) - base.top
    left -= base.left
    pieces.push(new Piece(left, top, width == null ? rightSide - leftSide : width, bottom - top, selectionClass))
  }

  function wrapX(pos: number, side: 1 | -1) {
    let dest = view.moveToLineBoundary(EditorSelection.cursor(pos, -side), side > 0)
    let coords = view.coordsAtPos(dest.from, -side as 1 | -1)
    return coords ? coords.left : (side < 0) == ltr ? leftSide : rightSide
  }

  // Gets passed from/to in line-local positions
  function drawForLine(line: Line, from: null | number, to: null | number) {
    let start: Rect | undefined, end: Rect | undefined
    let bidi = view.bidiSpans(line)
    for (let i = 0; i < bidi.length; i++) {
      let span = bidi[i]
      if (to != null && span.from > to || from != null && span.to < from) continue
      let sFrom = Math.max(span.from, from || 0), sTo = Math.min(span.to, to ?? 1e9)
      let fromCoords = view.coordsAtPos(sFrom + line.from, 1), toCoords = view.coordsAtPos(sTo + line.from, -1)
      if (!fromCoords || !toCoords) continue // FIXME
      let openStart = from == null && sFrom == 0, openEnd = to == null && sTo == line.length
      let first = i == 0, last = i == bidi.length - 1
      if (toCoords.bottom - fromCoords.bottom <= 3) { // Single line
        let openLeft = (ltr ? openStart : openEnd) && first
        let openRight = (ltr ? openEnd : openStart) && last
        let left = openLeft ? leftSide : (span.dir == Direction.LTR ? fromCoords : toCoords).left
        let right = openRight ? rightSide : (span.dir == Direction.LTR ? toCoords : fromCoords).right
        add(left, fromCoords.top, right - left, fromCoords.bottom)
      } else { // Multiple lines
        let topLeft, topRight, botLeft, botRight
        if (span.dir == Direction.LTR) {
          topLeft = ltr && openStart && first ? leftSide : fromCoords.left
          topRight = ltr ? rightSide : wrapX(sFrom, -1)
          botLeft = ltr ? leftSide : wrapX(sTo, 1)
          botRight = ltr && openEnd && last ? rightSide : toCoords.right
        } else {
          topLeft = !ltr ? leftSide : wrapX(sFrom, -1)
          topRight = !ltr && openStart && first ? rightSide : fromCoords.right
          botLeft = !ltr && openEnd && last ? leftSide : toCoords.left
          botRight = !ltr ? rightSide : wrapX(sTo, 1)
        }
        add(topLeft, fromCoords.top, topRight - topLeft, fromCoords.bottom)
        if (fromCoords.bottom < toCoords.top) add(leftSide, fromCoords.bottom, null, toCoords.top)
        add(botLeft, toCoords.top, botRight - botLeft, toCoords.bottom)
      }

      if (!start || cmpCoords(fromCoords, start) < 0) start = fromCoords
      if (cmpCoords(toCoords, start) < 0) start = toCoords
      if (!end || cmpCoords(fromCoords, end) < 0) end = fromCoords
      if (cmpCoords(toCoords, end) < 0) end = toCoords
    }
    return {start: start!, end: end!}
  }

  var lineFrom = view.state.doc.lineAt(range.from), lineTo = view.state.doc.lineAt(range.to)
  if (lineFrom.from == lineTo.from) {
    drawForLine(lineFrom, range.from - lineFrom.from, range.to - lineFrom.from)
  } else {
    let singleVLine = view.visualLineAt(range.from).from == view.visualLineAt(range.to).from
    let fromEnd = drawForLine(lineFrom, range.from - lineFrom.from, singleVLine ? lineFrom.length : null).end
    let toStart = drawForLine(lineTo, singleVLine ? 0 : null, range.to - lineTo.from).start
    if (singleVLine) {
      if (fromEnd.top < toStart.top - 2) {
        add(fromEnd.right, fromEnd.top, null, fromEnd.bottom);
        add(leftSide, toStart.top, toStart.left, toStart.bottom);
      } else {
        add(fromEnd.right, fromEnd.top, toStart.left - fromEnd.right, fromEnd.bottom);
      }
    }
    if (fromEnd.bottom < toStart.top)
      add(leftSide, fromEnd.bottom, null, toStart.top)
  }

  return pieces
}

const primaryCursorClass = themeClass("cursor.primary")
const cursorClass = themeClass("cursor.secondary")

function measureCursor(view: EditorView, cursor: SelectionRange, primary: boolean): Piece | null {
  let pos = view.coordsAtPos(cursor.head, cursor.assoc || 1)
  if (!pos) return null
  let base = view.scrollDOM.getBoundingClientRect()
  return new Piece(pos.left - base.left, pos.top - base.top, -1, pos.bottom - pos.top,
                   primary ? primaryCursorClass : cursorClass)
}
