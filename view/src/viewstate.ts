import {Text} from "../../text"
import {EditorState, ChangedRange, Mapping} from "../../state"
import {DecorationSet, Decoration, joinRanges, findChangedRanges} from "./decoration"
import {HeightMap, HeightOracle, BlockInfo, MeasuredHeights, QueryType} from "./heightmap"
import {decorations, ViewUpdate, UpdateFlag} from "./extension"
import {DocView} from "./docview"

const none: readonly any[] = []

function visiblePixelRange(dom: HTMLElement, paddingTop: number): {top: number, bottom: number} {
  let rect = dom.getBoundingClientRect()
  let top = Math.max(0, Math.min(innerHeight, rect.top)), bottom = Math.max(0, Math.min(innerHeight, rect.bottom))
  for (let parent = dom.parentNode as any; parent;) { // (Cast to any because TypeScript is useless with Node types)
    if (parent.nodeType == 1) {
      if (parent.scrollHeight > parent.clientHeight) {
        let parentRect = parent.getBoundingClientRect()
        top = Math.min(parentRect.bottom, Math.max(parentRect.top, top))
        bottom = Math.min(parentRect.bottom, Math.max(parentRect.top, bottom))
      }
      parent = parent.parentNode
    } else if (parent.nodeType == 11) { // Shadow root
      parent = parent.host
    } else {
      break
    }
  }
  return {top: top - (rect.top + paddingTop), bottom: bottom - (rect.top + paddingTop)}
}

const VIEWPORT_MARGIN = 1000 // FIXME look into appropriate value of this through benchmarking etc
const MIN_COVER_MARGIN = 10  // coveredBy requires at least this many extra pixels to be covered
const MAX_COVER_MARGIN = VIEWPORT_MARGIN / 4

export class ViewState {
  // These are contentDOM-local coordinates
  viewportTop = 0
  viewportBottom = 0

  paddingTop = 0
  paddingBottom = 0

  heightOracle: HeightOracle = new HeightOracle
  heightMap: HeightMap = HeightMap.empty()

  scrollTo = -1
  // Briefly set to true when printing, to disable viewport limiting
  printing = false

  viewport: Viewport

  constructor(public state: EditorState) {
    this.heightMap = this.heightMap.applyChanges(state.facet(decorations), Text.empty, this.heightOracle.setDoc(state.doc),
                                                 [new ChangedRange(0, 0, 0, state.doc.length)])
    this.viewport = this.getViewport(0, -1)
  }

  update(update: ViewUpdate, scrollTo = -1) {
    let prev = this.state
    this.state = update.state
    let newDeco = this.state.facet(decorations)
    let contentChanges = update.changes.changedRanges()
    let {content, height} = decoChanges(update ? contentChanges : none,
                                        newDeco, update.prevState.facet(decorations),
                                        prev.doc.length)
    let heightChanges = extendWithRanges(contentChanges, height), prevHeight = this.heightMap.height
    this.heightMap = this.heightMap.applyChanges(newDeco, prev.doc, this.heightOracle.setDoc(this.state.doc), heightChanges)
    if (this.heightMap.height != prevHeight) update.flags |= UpdateFlag.Height

    let viewport = heightChanges.length ? this.mapViewport(this.viewport, update.changes) : this.viewport
    if (!viewport || scrollTo > -1 && (scrollTo < viewport.from || scrollTo > viewport.to) ||
        !this.viewportIsCovering(viewport))
      viewport = this.getViewport(0, scrollTo)
    if (!viewport.eq(this.viewport)) {
      this.viewport = viewport
      update.flags |= UpdateFlag.Viewport
    }
    if (scrollTo > -1) this.scrollTo = scrollTo

    return extendWithRanges(contentChanges, content)
  }

  measure(docView: DocView, repeated: boolean) {
    let dom = docView.dom

    if (!repeated) {
      // Vertical padding
      let style = window.getComputedStyle(dom)
      this.paddingTop = parseInt(style.paddingTop!) || 0
      this.paddingBottom = parseInt(style.paddingBottom!) || 0
    }

    // Pixel viewport
    let {top, bottom} = this.printing ? {top: -1e8, bottom: 1e8} : visiblePixelRange(dom, this.paddingTop)
    this.viewportTop = top; this.viewportBottom = bottom
    if (bottom <= top) return 0

    let lineHeights = docView.measureVisibleLineHeights()
    let refresh = false, bias = 0

    if (!repeated) {
      if (this.heightOracle.mustRefresh(lineHeights)) {
        let {lineHeight, charWidth} = docView.measureTextSize()
        refresh = this.heightOracle.refresh(window.getComputedStyle(dom).whiteSpace!, lineHeight, charWidth,
                                            (docView.dom).clientWidth / charWidth, lineHeights)
        if (refresh) docView.minWidth = 0
      }

      let dTop = top - this.viewportTop, dBottom = bottom - this.viewportBottom
      if (dTop > 0 && dBottom > 0) bias = Math.max(dTop, dBottom)
      else if (dTop < 0 && dBottom < 0) bias = Math.min(dTop, dBottom)
    }

    this.heightOracle.heightChanged = false
    this.heightMap = this.heightMap.updateHeight(
      this.heightOracle, 0, refresh, new MeasuredHeights(this.viewport.from, lineHeights))

    let result = this.heightOracle.heightChanged ? UpdateFlag.Height : 0
    let scrollTo = this.scrollTo
    this.scrollTo = -1
    if (!this.viewportIsCovering(this.viewport, bias) ||
        scrollTo > -1 && (scrollTo < this.viewport.from || scrollTo > this.viewport.to)) {
      this.viewport = this.getViewport(bias, scrollTo)
      result |= UpdateFlag.Viewport
    }
    if (scrollTo > -1) docView.scrollPosIntoView(scrollTo) // FIXME return instead?
    return result
  }

  getViewport(bias: number, scrollTo: number): Viewport {
    // This will divide VIEWPORT_MARGIN between the top and the
    // bottom, depending on the bias (the change in viewport position
    // since the last update). It'll hold a number between 0 and 1
    let marginTop = 0.5 - Math.max(-0.5, Math.min(0.5, bias / VIEWPORT_MARGIN / 2))
    let map = this.heightMap, doc = this.state.doc, top = this.viewportTop, bottom = this.viewportBottom
    let viewport = new Viewport(map.lineAt(top - marginTop * VIEWPORT_MARGIN, QueryType.ByHeight, doc, 0, 0).from,
                                map.lineAt(bottom + (1 - marginTop) * VIEWPORT_MARGIN, QueryType.ByHeight, doc, 0, 0).to)
    // If scrollTo is > -1, make sure the viewport includes that position
    if (scrollTo > -1) {
      if (scrollTo < viewport.from) {
        let {top} = map.lineAt(scrollTo, QueryType.ByPos, doc, 0, 0)
        viewport = new Viewport(map.lineAt(top - VIEWPORT_MARGIN / 2, QueryType.ByHeight, doc, 0, 0).from,
                                map.lineAt(top + (bottom - top) + VIEWPORT_MARGIN / 2, QueryType.ByHeight, doc, 0, 0).to)
      } else if (scrollTo > viewport.to) {
        let {bottom} = map.lineAt(scrollTo, QueryType.ByPos, doc, 0, 0)
        viewport = new Viewport(map.lineAt(bottom - (bottom - top) - VIEWPORT_MARGIN / 2, QueryType.ByHeight, doc, 0, 0).from,
                                map.lineAt(bottom + VIEWPORT_MARGIN / 2, QueryType.ByHeight, doc, 0, 0).to)
      }
    }
    return viewport
  }

  mapViewport(viewport: Viewport, changes: Mapping) {
    let from = changes.mapPos(viewport.from, -1), to = changes.mapPos(viewport.to, 1)
    if ((to - from) - (viewport.to - viewport.from) > 100) return null // Grew too much, recompute
    return new Viewport(this.heightMap.lineAt(from, QueryType.ByPos, this.state.doc, 0, 0).from,
                        this.heightMap.lineAt(to, QueryType.ByPos, this.state.doc, 0, 0).to)
  }

  viewportIsCovering({from, to}: Viewport, bias = 0) {
    let {top} = this.heightMap.lineAt(from, QueryType.ByPos, this.state.doc, 0, 0)
    let {bottom} = this.heightMap.lineAt(to, QueryType.ByPos, this.state.doc, 0, 0)
    return (from == 0 || top <= this.viewportTop - Math.max(MIN_COVER_MARGIN, Math.min(-bias, MAX_COVER_MARGIN))) &&
      (to == this.state.doc.length || bottom >= this.viewportBottom + Math.max(MIN_COVER_MARGIN, Math.min(bias, MAX_COVER_MARGIN)))
  }

  lineAt(pos: number, editorTop: number): BlockInfo {
    return this.heightMap.lineAt(pos, QueryType.ByPos, this.state.doc, editorTop + this.paddingTop, 0)
  }

  lineAtHeight(height: number, editorTop: number): BlockInfo {
    return this.heightMap.lineAt(height, QueryType.ByHeight, this.state.doc, editorTop + this.paddingTop, 0)
  }

  blockAtHeight(height: number, editorTop: number): BlockInfo {
    return this.heightMap.blockAt(height, this.state.doc, editorTop + this.paddingTop, 0)
  }

  forEachLine(from: number, to: number, f: (line: BlockInfo) => void, editorTop: number) {
    return this.heightMap.forEachLine(from, to, this.state.doc, editorTop + this.paddingTop, 0, f)
  }
}

/// Indicates the range of the document that is in the visible
/// viewport.
export class Viewport {
  constructor(readonly from: number, readonly to: number) {}
  eq(b: Viewport) { return this.from == b.from && this.to == b.to }
}

// FIXME find some more robust way to do this in the face of changing sets
export function decoChanges(diff: readonly ChangedRange[], decorations: readonly DecorationSet[],
                            oldDecorations: readonly DecorationSet[], oldLength: number): {content: number[], height: number[]} {
  let contentRanges: number[] = [], heightRanges: number[] = []
  for (let max = Math.max(decorations.length, oldDecorations.length), i = 0; i < max; i++) {
    let a = decorations[i] || Decoration.none, b = oldDecorations[i] || Decoration.none
    if (a.size == 0 && b.size == 0) continue
    let newRanges = findChangedRanges(b, a, diff, oldLength)
    contentRanges = joinRanges(contentRanges, newRanges.content)
    heightRanges = joinRanges(heightRanges, newRanges.height)
  }
  return {content: contentRanges, height: heightRanges}
}

export function extendWithRanges(diff: readonly ChangedRange[], ranges: number[]): readonly ChangedRange[] {
  if (ranges.length == 0) return diff
  let result: ChangedRange[] = []
  for (let dI = 0, rI = 0, posA = 0, posB = 0;; dI++) {
    let next = dI == diff.length ? null : diff[dI], off = posA - posB
    let end = next ? next.fromB : 1e9
    while (rI < ranges.length && ranges[rI] < end) {
      let from = ranges[rI], to = ranges[rI + 1]
      let fromB = Math.max(posB, from), toB = Math.min(end, to)
      if (fromB <= toB) new ChangedRange(fromB + off, toB + off, fromB, toB).addToSet(result)
      if (to > end) break
      else rI += 2
    }
    if (!next) return result
    new ChangedRange(next.fromA, next.toA, next.fromB, next.toB).addToSet(result)
    posA = next.toA; posB = next.toB
  }
}
