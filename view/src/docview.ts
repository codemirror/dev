import {ContentView, ChildCursor, dirty} from "./contentview"
import {LineView} from "./lineview"
import {InlineView, InlineBuilder} from "./inlineview"
import {Viewport, ViewportState} from "./viewport"
import {Text} from "../../doc/src/text"
import {DOMObserver} from "./domobserver"
import {EditorSelection, Transaction} from "../../state/src"
import {HeightMap, HeightOracle} from "./heightmap"
import {ChangedRange} from "./changes"
import {Decoration, DecorationSet, joinRanges, findChangedRanges} from "./decoration"
import {getRoot, clientRectsFor, isEquivalentPosition, scrollRectIntoView} from "./dom"

type A<T> = ReadonlyArray<T>

export class DocView extends ContentView {
  children: ContentView[] = [new LineView(this, [])]
  visiblePart: Viewport = Viewport.empty
  viewports: Viewport[] = []
  publicViewport: EditorViewport

  text: Text = Text.create("")
  decorations: A<DecorationSet> = []
  selection: EditorSelection = EditorSelection.default

  observer: DOMObserver

  viewportState: ViewportState
  heightMap: HeightMap = HeightMap.empty()
  heightOracle: HeightOracle = new HeightOracle

  layoutCheckScheduled: number = -1
  // A document position that has to be scrolled into view at the next layout check
  scrollIntoView: number = -1

  dom!: HTMLElement

  get length() { return this.text.length }

  get childGap() { return 1 }

  constructor(dom: HTMLElement, private callbacks: {
    onDOMChange: (from: number, to: number, typeOver: boolean) => void,
    onSelectionChange: () => void,
    onUpdateDOM: () => void,
    onUpdateViewport: () => void,
    getDecorations: () => DecorationSet[]
  }) {
    super(null, dom)
    this.dirty = dirty.node

    this.viewportState = new ViewportState
    this.observer = new DOMObserver(this, callbacks.onDOMChange, callbacks.onSelectionChange, () => this.checkLayout())
    this.publicViewport = new EditorViewport(this, 0, 0) // FIXME initialize differently?x
  }

  // FIXME need some way to stabilize viewport—if a change causes the
  // top of the visible viewport to move, scroll position should be
  // adjusted to keep the content in place
  update(doc: Text, selection: EditorSelection, changedRanges?: ChangedRange[], scrollIntoView: number = -1) {
    this.scrollIntoView = scrollIntoView
    let decorations = this.callbacks.getDecorations()
    if (this.dirty == dirty.not && this.text.eq(doc) && sameArray(decorations, this.decorations)) {
      if (selection.eq(this.selection) && scrollIntoView < 0) return
      if (selection.primary.from >= this.visiblePart.from &&
          selection.primary.to <= this.visiblePart.to) {
        this.selection = selection
        this.observer.withoutSelectionListening(() => this.updateSelection())
        return
      }
    }

    let oldLength = this.text.length
    if (!changedRanges) changedRanges = [new ChangedRange(0, oldLength, 0, doc.length)]
    let changes = decoChanges(changedRanges, decorations, this.decorations, doc.length)
    this.text = doc
    this.decorations = decorations
    this.selection = selection
    this.heightMap = this.heightMap.applyChanges(decorations.filter(d => d.size > 0),
                                                 this.heightOracle.setDoc(doc), extendWithRanges(changedRanges, changes.height))

    let {viewport, changes: contentChanges} = this.getViewport(0, scrollIntoView, extendWithRanges(changedRanges, changes.content))
    this.updateInner(contentChanges, oldLength, viewport)

    if (this.layoutCheckScheduled < 0)
      this.layoutCheckScheduled = requestAnimationFrame(() => this.checkLayout())
    this.callbacks.onUpdateDOM()
  }

  private updateInner(changes: A<ChangedRange>, oldLength: number, visible: Viewport) {
    this.visiblePart = visible
    let viewports: Viewport[] = [visible]
    let {head, anchor} = this.selection.primary
    if (head < visible.from || head > visible.to)
      viewports.push(this.heightMap.lineViewport(head, this.text))
    if (!viewports.some(({from, to}) => anchor >= from && anchor <= to))
      viewports.push(this.heightMap.lineViewport(anchor, this.text))
    viewports.sort((a, b) => a.from - b.from)
    let matchingRanges = findMatchingRanges(viewports, this.viewports, changes)

    let decoSets = this.decorations.filter(d => d.size > 0)

    let cursor = new ChildCursor(this.children, oldLength, 1)
    let posB = this.text.length
    for (let i = viewports.length - 1;; i--) {
      let endI = cursor.i
      cursor.findPos(i < 0 ? 0 : matchingRanges[i].to + 1)
      let gap = cursor.i < endI && this.children[cursor.i] instanceof GapView ? this.children[cursor.i] as GapView : null
      let nextB = i < 0 ? 0 : viewports[i].to + 1
      if (posB >= nextB) {
        if (!gap || endI - cursor.i != 1) {
          if (!gap) gap = new GapView(this)
          this.replaceChildren(cursor.i, endI, [gap])
        }
        gap.update(posB - nextB, this.heightMap.heightAt(posB, this.text, 1) - this.heightMap.heightAt(nextB, this.text, -1))
      } else if (endI != cursor.i) {
        this.replaceChildren(cursor.i, endI)
      }

      if (i < 0) break

      let viewport = viewports[i], matching = matchingRanges[i]
      endI = cursor.i
      if (matching.from == matching.to) {
        this.replaceChildren(cursor.i, endI, [new LineView(this, [])])
        endI = cursor.i + 1
      } else {
        cursor.findPos(matching.from)
      }
      this.updatePart(cursor.i, endI, matching, viewport, changes, decoSets)
      posB = viewport.from - 1
    }

    this.viewports = viewports
    this.observer.withoutListening(() => {
      // Lock the height during redrawing, since Chrome sometimes
      // messes with the scroll position during DOM mutation (though
      // no relayout is triggered and I cannot imagine how it can
      // recompute the scroll position without a layout)
      this.dom.style.height = this.heightMap.height + "px"
      this.sync()
      this.updateSelection()
      this.dom.style.height = ""
    })
  }

  private updatePart(startI: number, endI: number, oldPort: Viewport, newPort: Viewport,
                     changes: A<ChangedRange>, decoSets: A<DecorationSet>) {
    let plan = clipPlan(changes, oldPort, newPort)
    let cur = new ChildCursor(this.children, oldPort.to, 1, endI)
    for (let i = plan.length - 1; i >= 0; i--) {
      let {fromA, toA, fromB, toB} = plan[i]
      let {i: toI, off: toOff} = cur.findPos(toA)
      let {i: fromI, off: fromOff} = cur.findPos(fromA)
      this.updatePartRange(fromI, fromOff, toI, toOff, InlineBuilder.build(this.text, fromB, toB, decoSets))
    }
  }

  private updatePartRange(fromI: number, fromOff: number, toI: number, toOff: number, lines: InlineView[][]) {
    // All children in the touched range should be line views
    let children = this.children as LineView[]
    if (lines.length == 1) {
      if (fromI == toI) { // Change within single line
        children[fromI].update(fromOff, toOff, lines[0])
      } else { // Join lines
        let tail = children[toI].detachTail(toOff)
        children[fromI].update(fromOff, undefined, InlineView.appendInline(lines[0], tail))
        this.replaceChildren(fromI + 1, toI + 1)
      }
    } else { // Across lines
      let tail = children[toI].detachTail(toOff)
      children[fromI].update(fromOff, undefined, lines[0])
      let insert = []
      for (let j = 1; j < lines.length; j++)
        insert.push(new LineView(this, j < lines.length - 1 ? lines[j] : InlineView.appendInline(lines[j], tail)))
      this.replaceChildren(fromI + 1, toI + 1, insert)
    }
  }

  updateSelection(takeFocus: boolean = false) {
    let root = getRoot(this.dom)
    if (!takeFocus && root.activeElement != this.dom) return

    let anchor = this.domFromPos(this.selection.primary.anchor)!
    let head = this.domFromPos(this.selection.primary.head)!

    let domSel = root.getSelection()
    // If the selection is already here, or in an equivalent position, don't touch it
    if (isEquivalentPosition(anchor.node, anchor.offset, domSel.anchorNode, domSel.anchorOffset) &&
        isEquivalentPosition(head.node, head.offset, domSel.focusNode, domSel.focusOffset))
      return

    let range = document.createRange()
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
  }

  getViewport(bias: number, scrollIntoView: number, changes: A<ChangedRange> = []): {
    viewport: Viewport,
    changes: A<ChangedRange>
  } {
    for (let i = 0;; i++) {
      let viewport = this.viewportState.getViewport(this.text, this.heightMap, bias, scrollIntoView)
      if (i == 5) console.warn("Viewport and decorations failed to converge")
      if (i == 5 || (viewport.from == this.publicViewport._from && viewport.to == this.publicViewport._to))
        return {viewport, changes}
      ;({from: this.publicViewport._from, to: this.publicViewport._to} = viewport)
      this.callbacks.onUpdateViewport()
      let decorations = this.callbacks.getDecorations()
      if (sameArray(decorations, this.decorations)) return {viewport, changes}
      let {content, height} = decoChanges([], decorations, this.decorations, this.text.length)
      this.decorations = decorations
      changes = extendWithRanges(changes, content)
      this.heightMap = this.heightMap.applyChanges(decorations, this.heightOracle, extendWithRanges([], height))
    }
  }

  focus() {
    this.observer.withoutSelectionListening(() => this.updateSelection(true))
  }

  checkLayout() {
    cancelAnimationFrame(this.layoutCheckScheduled)
    this.layoutCheckScheduled = -1

    let scrollIntoView = Math.min(this.scrollIntoView, this.text.length)
    this.scrollIntoView = -1
    let scrollBias = this.viewportState.updateFromDOM(this.dom)
    if (this.viewportState.top >= this.viewportState.bottom) return // We're invisible!

    let lineHeights: number[] | null = this.measureVisibleLineHeights(), refresh = false
    if (this.heightOracle.maybeRefresh(lineHeights)) {
      let {lineHeight, charWidth} = this.measureTextSize()
      refresh = this.heightOracle.refresh(getComputedStyle(this.dom).whiteSpace!,
                                          lineHeight, (this.dom).clientWidth / charWidth, lineHeights)
    }

    if (scrollIntoView > -1) scrollRectIntoView(this.dom, this.coordsAt(scrollIntoView)!)

    let updated = false
    for (let i = 0;; i++) {
      this.heightOracle.heightChanged = false
      this.heightMap = this.heightMap.updateHeight(this.heightOracle, 0, refresh,
                                                   this.visiblePart.from, this.visiblePart.to,
                                                   lineHeights || this.measureVisibleLineHeights())
      let covered = this.viewportState.coveredBy(this.text, this.visiblePart, this.heightMap, scrollBias)
      if (this.heightOracle.heightChanged || !covered) updated = true
      if (covered) break
      if (i > 10) throw new Error("Layout failed to converge")
      let viewport = this.visiblePart, contentChanges: A<ChangedRange> = []
      if (!covered) ({viewport, changes: contentChanges} = this.getViewport(scrollBias, -1, []))
      this.updateInner(contentChanges, this.text.length, viewport)
      lineHeights = null
      refresh = false
      scrollBias = 0
      this.viewportState.updateFromDOM(this.dom)
    }
    if (updated) {
      this.observer.listenForScroll()
      this.callbacks.onUpdateDOM()
    }
  }

  nearest(dom: Node): ContentView | null {
    for (let cur: Node | null = dom; cur;) {
      let domView = cur.cmView
      if (domView) {
        for (let v: ContentView | null = domView; v; v = v.parent)
          if (v == this) return domView
      }
      cur = cur.parentNode
    }
    return null
  }

  posFromDOM(node: Node, offset: number): number {
    let view = this.nearest(node)
    if (!view) throw new RangeError("Trying to find position for a DOM position outside of the document")
    return view.localPosFromDOM(node, offset) + view.posAtStart
  }

  domFromPos(pos: number): {node: Node, offset: number} | null {
    let {i, off} = new ChildCursor(this.children, this.text.length, 1).findPos(pos)
    return this.children[i].domFromPos(off)
  }

  measureVisibleLineHeights() {
    let result = [], {from, to} = this.visiblePart
    for (let pos = 0, i = 0; pos <= to; i++) {
      let child = this.children[i]
      if (pos >= from)
        result.push(child.length, (child.dom as HTMLElement).getBoundingClientRect().height)
      pos += child.length + 1
    }
    return result
  }

  measureTextSize(): {lineHeight: number, charWidth: number} {
    for (let child of this.children) {
      if (child instanceof LineView) {
        let measure = child.measureTextSize()
        if (measure) return measure
      }
    }
    // If no workable line exists, force a layout of a measurable element
    let dummy = document.createElement("div"), lineHeight!: number, charWidth!: number
    dummy.style.cssText = "contain: strict"
    dummy.textContent = "abc def ghi jkl mno pqr stu"
    this.observer.withoutListening(() => {
      this.dom.appendChild(dummy)
      let rect = clientRectsFor(dummy.firstChild!)[0]
      lineHeight = dummy.getBoundingClientRect().height
      charWidth = rect ? rect.width / 27 : 7
      dummy.remove()
    })
    return {lineHeight, charWidth}
  }

  destroy() {
    cancelAnimationFrame(this.layoutCheckScheduled)
    this.observer.destroy()
  }
}

const noChildren: ContentView[] = []

class GapView extends ContentView {
  length: number = 0
  height: number = 0
  dom!: HTMLElement

  constructor(parent: ContentView) {
    super(parent, document.createElement("div"))
    this.dom.contentEditable = "false"
  }

  get children() { return noChildren }

  update(length: number, height: number) {
    this.length = length
    if (height != this.height) {
      this.height = height
      this.markDirty()
    }
  }

  sync() {
    // FIXME on Firefox heights over 17895697 are ignored. Work around that?
    if (this.dirty) {
      this.dom.style.height = this.height + "px"
      this.dirty = dirty.not
    }
  }

  get overrideDOMText() {
    return this.parent ? (this.parent as DocView).text.slice(this.posAtStart, this.posAtEnd) : ""
  }

  domBoundsAround() { return null }
}

function decoChanges(diff: A<ChangedRange>, decorations: A<DecorationSet>,
                     oldDecorations: A<DecorationSet>, length: number): {content: number[], height: number[]} {
  let contentRanges: number[] = [], heightRanges: number[] = []
  for (let i = decorations.length - 1; i >= 0; i--) {
    let deco = decorations[i], oldDeco = i < oldDecorations.length ? oldDecorations[i] : Decoration.none
    if (deco.size == 0 && oldDeco.size == 0) continue
    let newRanges = findChangedRanges(oldDeco, deco, diff, length)
    contentRanges = joinRanges(contentRanges, newRanges.content)
    heightRanges = joinRanges(heightRanges, newRanges.height)
  }
  return {content: contentRanges, height: heightRanges}
}

function addChangedRange(ranges: ChangedRange[], fromA: number, toA: number, fromB: number, toB: number) {
  if (ranges.length) {
    let last = ranges[ranges.length - 1]
    if (last.toA == fromA && last.toB == fromB) {
      ranges[ranges.length - 1] = new ChangedRange(last.fromA, toA, last.fromB, toB)
      return
    }
  }
  ranges.push(new ChangedRange(fromA, toA, fromB, toB))
}

function extendWithRanges(diff: A<ChangedRange>, ranges: number[]): A<ChangedRange> {
  let result: ChangedRange[] = []
  for (let dI = 0, rI = 0, posA = 0, posB = 0;; dI++) {
    let next = dI == diff.length ? null : diff[dI], off = posA - posB
    let end = next ? next.fromB : 2e9
    while (rI < ranges.length && ranges[rI] < end) {
      let from = ranges[rI], to = ranges[rI + 1]
      let fromB = Math.max(posB, from), toB = Math.min(end, to)
      if (fromB <= toB) addChangedRange(result, fromB + off, toB + off, fromB, toB)
      if (to > end) break
      else rI += 2
    }
    if (!next) return result
    addChangedRange(result, next.fromA, next.toA, next.fromB, next.toB)
    posA = next.toA; posB = next.toB
  }
}

function sameArray<T>(a: A<T>, b: A<T>) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function boundAfter(viewport: Viewport, pos: number): number {
  return pos < viewport.from ? viewport.from : pos < viewport.to ? viewport.to : 2e9 + 1
}
 
// Transforms a plan to take viewports into account. Discards changes
// (or part of changes) that are outside of the viewport, and adds
// ranges for text that was in one viewport but not the other (so that
// old text is cleared out and newly visible text is drawn).
function clipPlan(plan: A<ChangedRange>, viewportA: Viewport, viewportB: Viewport): A<ChangedRange> {
  let result: ChangedRange[] = []
  let posA = 0, posB = 0
  for (let i = 0;; i++) {
    let range = i < plan.length ? plan[i] : null
    // Look at the unchanged range before the next range (or the end
    // if there is no next range), divide it by viewport boundaries,
    // and for each piece, if it is only in one viewport, add a
    // changed range.
    let nextA = range ? range.fromA : 2e9, nextB = range ? range.fromB : 2e9
    while (posA < nextA) {
      let advance = Math.min(Math.min(boundAfter(viewportA, posA), nextA) - posA,
                             Math.min(boundAfter(viewportB, posB), nextB) - posB)
      if (advance == 0) break
      let endA = posA + advance, endB = posB + advance
      if ((posA >= viewportA.to || endA <= viewportA.from) != (posB >= viewportB.to || endB <= viewportB.from))
        addChangedRange(result, viewportA.clip(posA), viewportA.clip(endA), viewportB.clip(posB), viewportB.clip(endB))
      posA = endA; posB = endB
    }

    if (!range || (range.fromA > viewportA.to && range.fromB > viewportB.to)) break

    // Clip existing ranges to the viewports
    if ((range.toA >= viewportA.from && range.fromA <= viewportA.to) ||
        (range.toB >= viewportB.from && range.fromB <= viewportB.to))
      addChangedRange(result, viewportA.clip(range.fromA), viewportA.clip(range.toA),
                      viewportB.clip(range.fromB), viewportB.clip(range.toB))

    posA = range.toA; posB = range.toB
  }

  return result
}

function mapThroughChanges(pos: number, bias: number, changes: A<ChangedRange>): number {
  let off = 0
  for (let range of changes) {
    if (pos < range.fromA) return pos + off
    if (pos <= range.toA) return bias < 0 ? range.fromA : range.toA
    off = range.toB - range.toA
  }
  return pos + off
}

function findMatchingRanges(viewports: A<Viewport>, prevViewports: A<Viewport>, changes: A<ChangedRange>): Viewport[] {
  let prevI = 0, result: Viewport[] = []
  outer: for (let viewport of viewports) {
    for (let j = prevI; j < prevViewports.length; j++) {
      let prev = prevViewports[j]
      if (mapThroughChanges(prev.from, 1, changes) < viewport.to &&
          mapThroughChanges(prev.to, -1, changes) > viewport.from) {
        result.push(prev)
        prevI = j + 1
        continue outer
      }
    }
    let at = result.length ? result[result.length - 1].to : 0
    result.push(new Viewport(at, at))
  }
  return result
}

// Public shim for giving client code access to viewport information
export class EditorViewport {
  /** @internal */
  constructor(private docView: DocView, public _from: number, public _to: number) {}

  /** @internal */
  map(transactions: Transaction[]) {
    for (let tr of transactions) {
      this._from = tr.changes.mapPos(this._from, 1)
      this._to = Math.max(this._from, tr.changes.mapPos(this._to, -1))
    }
  }

  get from() { return this._from }
  get to() { return this._to }

  forEachLine(f: (from: number, to: number, line: {readonly height: number, readonly hasCollapsedRanges: boolean}) => void) {
    this.docView.heightMap.forEachLine(this.from, this.to, 0, this.docView.heightOracle, f)
  }
}
