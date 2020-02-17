import {Text} from "../../text"
import {EditorState, ChangedRange, ChangeSet, Mapping} from "../../state"
import {RangeSet} from "../../rangeset"
import {Rect} from "./dom"
import {HeightMap, HeightOracle, BlockInfo, MeasuredHeights, QueryType, heightRelevantDecoChanges} from "./heightmap"
import {decorations, ViewUpdate, UpdateFlag} from "./extension"
import {DocView} from "./docview"
import {posAtCoords} from "./cursor"

function visiblePixelRange(dom: HTMLElement, paddingTop: number): Rect {
  let rect = dom.getBoundingClientRect()
  let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right)
  let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
  for (let parent = dom.parentNode as any; parent;) { // (Cast to any because TypeScript is useless with Node types)
    if (parent.nodeType == 1) {
      if (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth) {
        let parentRect = parent.getBoundingClientRect()
        left = Math.max(left, parentRect.left)
        right = Math.min(right, parentRect.right)
        top = Math.max(top, parentRect.top)
        bottom = Math.min(bottom, parentRect.bottom)
      }
      parent = parent.parentNode
    } else if (parent.nodeType == 11) { // Shadow root
      parent = parent.host
    } else {
      break
    }
  }
  
  return {left: left - rect.left, right: right - rect.left,
          top: top - (rect.top + paddingTop), bottom: bottom - (rect.top + paddingTop)}
}

const enum VP {
  // FIXME look into appropriate value of this through benchmarking etc
  Margin = 1000,
  // coveredBy requires at least this many extra pixels to be covered
  MinCoverMargin = 10,
  MaxCoverMargin = VP.Margin / 4
}

export class LineGap {
  constructor(readonly from: number, readonly to: number, readonly size: number) {}
}

const enum LG { Margin = 10000, HalfMargin = LG.Margin >> 1,  MinViewPort = LG.Margin * 1.5 }

export class ViewState {
  // These are contentDOM-local coordinates
  pixelViewport: Rect = {left: 0, right: window.innerWidth, top: 0, bottom: 0}

  paddingTop = 0
  paddingBottom = 0

  heightOracle: HeightOracle = new HeightOracle
  heightMap: HeightMap = HeightMap.empty()

  scrollTo = -1
  // Briefly set to true when printing, to disable viewport limiting
  printing = false

  viewport: Viewport
  lineGaps: readonly LineGap[] = []

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
    
    let heightChanges = extendWithRanges(contentChanges, heightRelevantDecoChanges(
      update.prevState.facet(decorations), newDeco,update ? contentChanges : [], this.state.doc.length))
    let prevHeight = this.heightMap.height
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
    if (this.lineGaps.length || this.viewport.to - this.viewport.from > LG.MinViewPort)
      this.lineGaps = this.ensureLineGaps(this.mapLineGaps(this.lineGaps, update.changes), null)

    if (scrollTo > -1) this.scrollTo = scrollTo
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
    let pixelViewport = this.printing ? {top: -1e8, bottom: 1e8, left: -1e8, right: 1e8} : visiblePixelRange(dom, this.paddingTop)
    let dTop = pixelViewport.top - this.pixelViewport.top, dBottom = pixelViewport.bottom - this.pixelViewport.bottom
    this.pixelViewport = pixelViewport
    if (this.pixelViewport.bottom <= this.pixelViewport.top ||
        this.pixelViewport.right <= this.pixelViewport.left) return 0

    let lineHeights = docView.measureVisibleLineHeights()
    let refresh = false, bias = 0

    if (!repeated) {
      if (this.heightOracle.mustRefresh(lineHeights)) {
        let {lineHeight, charWidth} = docView.measureTextSize()
        refresh = this.heightOracle.refresh(window.getComputedStyle(dom).whiteSpace!, lineHeight, charWidth,
                                            (docView.dom).clientWidth / charWidth, lineHeights)
        if (refresh) {
          docView.minWidth = 0
          this.lineGaps = []
        }
      }

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
    if (this.lineGaps.length || this.viewport.to - this.viewport.from > LG.MinViewPort)
      this.lineGaps = this.ensureLineGaps(this.lineGaps, docView)

    if (scrollTo > -1) docView.scrollPosIntoView(scrollTo) // FIXME return instead?
    return result
  }

  getViewport(bias: number, scrollTo: number): Viewport {
    // This will divide VP.Margin between the top and the
    // bottom, depending on the bias (the change in viewport position
    // since the last update). It'll hold a number between 0 and 1
    let marginTop = 0.5 - Math.max(-0.5, Math.min(0.5, bias / VP.Margin / 2))
    let map = this.heightMap, doc = this.state.doc, {top, bottom} = this.pixelViewport
    let viewport = new Viewport(map.lineAt(top - marginTop * VP.Margin, QueryType.ByHeight, doc, 0, 0).from,
                                map.lineAt(bottom + (1 - marginTop) * VP.Margin, QueryType.ByHeight, doc, 0, 0).to)
    // If scrollTo is > -1, make sure the viewport includes that position
    if (scrollTo > -1) {
      if (scrollTo < viewport.from) {
        let {top: newTop} = map.lineAt(scrollTo, QueryType.ByPos, doc, 0, 0)
        viewport = new Viewport(map.lineAt(newTop - VP.Margin / 2, QueryType.ByHeight, doc, 0, 0).from,
                                map.lineAt(newTop + (bottom - top) + VP.Margin / 2, QueryType.ByHeight, doc, 0, 0).to)
      } else if (scrollTo > viewport.to) {
        let {bottom: newBottom} = map.lineAt(scrollTo, QueryType.ByPos, doc, 0, 0)
        viewport = new Viewport(map.lineAt(newBottom - (bottom - top) - VP.Margin / 2, QueryType.ByHeight, doc, 0, 0).from,
                                map.lineAt(newBottom + VP.Margin / 2, QueryType.ByHeight, doc, 0, 0).to)
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
    return (from == 0 || top <= this.pixelViewport.top - Math.max(VP.MinCoverMargin, Math.min(-bias, VP.MaxCoverMargin))) &&
      (to == this.state.doc.length ||
       bottom >= this.pixelViewport.bottom + Math.max(VP.MinCoverMargin, Math.min(bias, VP.MaxCoverMargin)))
  }

  mapLineGaps(gaps: readonly LineGap[], changes: ChangeSet) {
    if (!gaps.length || !changes.changes.length) return gaps
    let mapped = []
    for (let gap of gaps) if (!changes.touchesRange(gap.from, gap.to))
      mapped.push(new LineGap(changes.mapPos(gap.from), changes.mapPos(gap.to), gap.size))
    return mapped
  }

  ensureLineGaps(current: readonly LineGap[], measure: DocView | null) {
    // FIXME this falls apart in predominantly right-to-left text
    // FIXME there are some corner cases, like a wrapped line falling
    // entirely outside of the line gap margin, that this doesn't
    // handle propertly
    let gaps: LineGap[] = []
    let rect = measure ? measure.dom.getBoundingClientRect() : {left: 0, top: 0}
    this.heightMap.forEachLine(this.viewport.from, this.viewport.to, this.state.doc, rect.top, 0, line => {
      if (line.length < LG.Margin) return
      let structure = lineStructure(line.from, line.to, this.state)
      if (structure.total < LG.Margin) return
      let viewFrom, viewTo
      if (this.heightOracle.lineWrapping) {
        if (line.from != this.viewport.from) viewFrom = line.from
        else if (measure) viewFrom = posAtCoords(measure.view, {x: rect.left, y: rect.top + this.pixelViewport.top})
        else viewFrom = findPosition(structure, (this.pixelViewport.top - line.top) / line.height)
        if (line.to != this.viewport.to) viewTo = line.to
        else if (measure) viewTo = posAtCoords(measure.view, {x: rect.left, y: this.pixelViewport.bottom + rect.top})
        else viewTo = findPosition(structure, (line.top - this.pixelViewport.bottom) / line.height)
      } else if (measure) {
        viewFrom = posAtCoords(measure.view, {x: rect.left + this.pixelViewport.left, y: line.top + 2})
        viewTo = posAtCoords(measure.view, {x: rect.left + this.pixelViewport.right, y: line.top + 2})
      } else {
        let totalWidth = structure.total * this.heightOracle.charWidth
        viewFrom = findPosition(structure, this.pixelViewport.left / totalWidth)
        viewTo = findPosition(structure, this.pixelViewport.right / totalWidth)
      }
      if (viewFrom - line.from > LG.Margin) {
        let gapTo = viewFrom - LG.Margin
        gaps.push(current.find(gap => gap.from == line.from && gap.to > gapTo - LG.HalfMargin && gap.to < gapTo + LG.HalfMargin) ||
                  new LineGap(line.from, gapTo, this.gapSize(line, gapTo, true, measure, structure)))
      }
      if (line.to - viewTo > LG.Margin) {
        let gapFrom = viewTo + LG.Margin
        gaps.push(current.find(gap => gap.to == line.to && gap.from > gapFrom - LG.HalfMargin && gap.from < gapFrom + LG.HalfMargin) ||
                  new LineGap(gapFrom, line.to, this.gapSize(line, gapFrom, false, measure, structure)))
      }
    })
    return gaps
  }

  gapSize(line: BlockInfo, pos: number, start: boolean, measure: DocView | null,
          structure: {total: number, ranges: {from: number, to: number}[]}) {
    if (this.heightOracle.lineWrapping) {
      if (measure) {
        let rect = measure.coordsAt(pos)
        if (rect) return start ? rect.bottom - line.top : line.bottom - rect.top
      }
      let height = line.height * findFraction(structure, pos)
      return start ? height : line.height - height
    } else {
      if (measure) {
        let rect = measure.coordsAt(pos), other = measure.coordsAt(start ? line.from : line.to)
        if (rect && other) return start ? rect.left - other.left : other.left - rect.left
      }
      let ratio = findFraction(structure, pos)
      return structure.total * this.heightOracle.charWidth * (start ? ratio : 1 - ratio)
    }
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

function lineStructure(from: number, to: number, state: EditorState) {
  let ranges = [], pos = 0, total = 0
  RangeSet.spans(state.facet(decorations), from, to, {
    span() {},
    point(from, to) {
      if (from > pos) { ranges.push({from: pos, to: from}); total += to - pos }
      pos = to
    },
    ignore(value) { return !value.point }
  })
  if (pos < to) { ranges.push({from: pos, to}); total += to - pos }
  return {total, ranges}
}

function findPosition({total, ranges}: {total: number, ranges: {from: number, to: number}[]}, ratio: number): number {
  if (ratio <= 0) return ranges[0].from
  if (ratio >= 1) return ranges[ranges.length - 1].to
  let dist = Math.floor(total * ratio)
  for (let i = 0;; i++) {
    let {from, to} = ranges[i], size = to - from
    if (dist <= size) return from + dist
    dist -= size
  }
}

function findFraction(structure: {total: number, ranges: {from: number, to: number}[]}, pos: number) {
  let counted = 0
  for (let {from, to} of structure.ranges) {
    if (pos <= to) {
      counted += pos - from
      break
    }
    counted += to - from
  }
  return counted / structure.total
}
