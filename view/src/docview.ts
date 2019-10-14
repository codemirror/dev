import {ContentView, ChildCursor, Dirty, DOMPos} from "./contentview"
import {BlockView, LineView} from "./blockview"
import {InlineView, CompositionView} from "./inlineview"
import {ContentBuilder} from "./buildview"
import {Viewport, ViewportState} from "./viewport"
import browser from "./browser"
import {DOMObserver} from "./domobserver"
import {HeightMap, QueryType, HeightOracle, MeasuredHeights, BlockInfo} from "./heightmap"
import {Decoration, DecorationSet, joinRanges, findChangedRanges,
        heightRelevantDecorations, WidgetType, BlockType} from "./decoration"
import {clientRectsFor, isEquivalentPosition, scrollRectIntoView, maxOffset, Rect} from "./dom"
import {ViewUpdate, decorations as decorationsBehavior, viewPlugin, ViewPluginValue} from "./extension"
import {EditorView, UpdateState} from "./editorview"
import {EditorState, ChangedRange} from "../../state"
import {Text} from "../../text"

const none = [] as any

export class DocView extends ContentView {
  children!: BlockView[]
  viewports: Viewport[] = none

  decorations!: readonly DecorationSet[]
  compositionDeco: DecorationSet = Decoration.none
  gapDeco: DecorationSet = Decoration.none
  selectionDirty: any = null

  observer: DOMObserver
  forceSelectionUpdate: boolean = false

  viewportState: ViewportState
  heightMap!: HeightMap
  heightOracle: HeightOracle = new HeightOracle

  layoutCheckScheduled: number = -1
  // A document position that has to be scrolled into view at the next layout check
  scrollIntoView: number = -1

  paddingTop: number = 0
  paddingBottom: number = 0

  // Track a minimum width for the editor. When measuring sizes in
  // checkLayout, this is updated to point at the width of a given
  // element and its extent in the document. When a change happens in
  // that range, these are reset. That way, once we've seen a
  // line/element of a given length, we keep the editor wide enough to
  // fit at least that element, until it is changed, at which point we
  // forget it again.
  minWidth = 0
  minWidthFrom = 0
  minWidthTo = 0

  // Track whether the DOM selection was set in a lossy way, so that
  // we don't mess it up when reading it back it
  impreciseAnchor: DOMPos | null = null
  impreciseHead: DOMPos | null = null

  dom!: HTMLElement

  get length() { return this.state.doc.length }

  get state() { return this.view.state }

  get viewport() { return this.view._viewport }

  get root() { return this.view.root }

  constructor(private view: EditorView, onDOMChange: (from: number, to: number, typeOver: boolean) => boolean) {
    super()
    this.setDOM(view.contentDOM)

    this.viewportState = new ViewportState
    this.observer = new DOMObserver(this, onDOMChange, () => this.checkLayout())
  }

  init(state: EditorState, initialize: (viewport: Viewport) => void) {
    let changedRanges = [new ChangedRange(0, 0, 0, state.doc.length)]
    this.heightMap = HeightMap.empty().applyChanges(none, Text.empty, this.heightOracle.setDoc(state.doc), changedRanges)
    this.children = [new LineView]
    this.children[0].setParent(this)
    this.viewports = this.decorations = none
    this.minWidth = 0
    this.compositionDeco = Decoration.none
    let contentChanges = this.computeUpdate(state, null, initialize, changedRanges, 0, -1)
    this.updateInner(contentChanges, 0)
    this.cancelLayoutCheck()
    this.layoutCheckScheduled = requestAnimationFrame(() => this.checkLayout())
  }

  // Update the document view to a given state. scrollIntoView can be
  // used as a hint to compute a new viewport that includes that
  // position, if we know the editor is going to scroll that position
  // into view.
  update(update: ViewUpdate | null, scrollIntoView: number = -1) {
    let prevDoc = this.state.doc
    let state = update ? update.state : this.state
    let changedRanges: ChangedRange[] = update ? update.changes.changedRanges() : none
    if (this.minWidth > 0 && changedRanges.length) {
      if (!changedRanges.every(({fromA, toA}) => toA < this.minWidthFrom || fromA > this.minWidthTo)) {
        this.minWidth = 0
      } else {
        this.minWidthFrom = ChangedRange.mapPos(this.minWidthFrom, 1, changedRanges)
        this.minWidthTo = ChangedRange.mapPos(this.minWidthTo, 1, changedRanges)
      }
    }
    this.heightMap = this.heightMap.applyChanges(none, prevDoc, this.heightOracle.setDoc(state.doc), changedRanges)

    let contentChanges = this.computeUpdate(state, update, null, changedRanges, 0, scrollIntoView)
    // When the DOM nodes around the selection are moved to another
    // parent, Chrome sometimes reports a different selection through
    // getSelection than the one that it actually shows to the user.
    // This forces a selection update when lines are joined to work
    // around that. Issue #54
    if (browser.chrome && !this.compositionDeco.size && update && update.changes.changes.some(ch => ch.text.length > 1))
      this.forceSelectionUpdate = true

    if (this.dirty == Dirty.Not && contentChanges.length == 0 &&
        this.state.selection.primary.from >= this.viewport.from &&
        this.state.selection.primary.to <= this.viewport.to &&
        (!update || update.metadata.length == 0)) {
      this.updateSelection()
      if (scrollIntoView > -1) this.scrollPosIntoView(scrollIntoView)
    } else {
      this.updateInner(contentChanges, prevDoc.length)
      this.cancelLayoutCheck()
      if (scrollIntoView > -1) this.scrollIntoView = scrollIntoView
      this.layoutCheckScheduled = requestAnimationFrame(() => this.checkLayout())
    }
  }

  // Used both by update and checkLayout do perform the actual DOM
  // update
  private updateInner(changes: readonly ChangedRange[], oldLength: number) {
    let visible = this.viewport, viewports: Viewport[] = [visible]
    let {head, anchor} = this.state.selection.primary
    if (head < visible.from || head > visible.to) {
      let {from, to} = this.lineAt(head, 0)
      viewports.push(new Viewport(from, to))
    }
    if (!viewports.some(({from, to}) => anchor >= from && anchor <= to)) {
      let {from, to} = this.lineAt(anchor, 0)
      viewports.push(new Viewport(from, to))
    }
    viewports.sort((a, b) => a.from - b.from)

    this.updateChildren(changes, viewports, oldLength)

    this.viewports = viewports
    this.observer.ignore(() => {
      // Lock the height during redrawing, since Chrome sometimes
      // messes with the scroll position during DOM mutation (though
      // no relayout is triggered and I cannot imagine how it can
      // recompute the scroll position without a layout)
      this.dom.style.height = this.heightMap.height + "px"
      this.dom.style.minWidth = this.minWidth + "px"
      this.sync()
      this.dirty = Dirty.Not
      this.updateSelection()
      this.dom.style.height = ""
    })
  }

  private updateChildren(changes: readonly ChangedRange[], viewports: readonly Viewport[], oldLength: number) {
    let gapDeco = this.computeGapDeco(viewports, this.length)
    let gapChanges = findChangedRanges(this.gapDeco, gapDeco, changes, oldLength)
    this.gapDeco = gapDeco
    changes = extendWithRanges(changes, gapChanges.content)

    let allDeco = [gapDeco].concat(this.decorations)
    let cursor = this.childCursor(oldLength)
    for (let i = changes.length - 1;; i--) {
      let next = i >= 0 ? changes[i] : null
      if (!next) break
      let {fromA, toA, fromB, toB} = next
      let {content, breakAtStart} = ContentBuilder.build(this.state.doc, fromB, toB, allDeco)
      let {i: toI, off: toOff} = cursor.findPos(toA, 1)
      let {i: fromI, off: fromOff} = cursor.findPos(fromA, -1)
      this.replaceRange(fromI, fromOff, toI, toOff, content, breakAtStart)
    }
  }

  private replaceRange(fromI: number, fromOff: number, toI: number, toOff: number,
                       content: BlockView[], breakAtStart: number) {
    let before = this.children[fromI], last = content.length ? content[content.length - 1] : null
    let breakAtEnd = last ? last.breakAfter : breakAtStart
    // Change within a single line
    if (fromI == toI && !breakAtStart && !breakAtEnd && content.length < 2 &&
        before.merge(fromOff, toOff, content.length ? last : null, fromOff == 0))
      return

    let after = this.children[toI]
    // Make sure the end of the line after the update is preserved in `after`
    if (toOff < after.length || after.children.length && after.children[after.children.length - 1].length == 0) {
      // If we're splitting a line, separate part of the start line to
      // avoid that being mangled when updating the start line.
      if (fromI == toI) {
        after = after.split(toOff)
        toOff = 0
      }
      // If the element after the replacement should be merged with
      // the last replacing element, update `content`
      if (!breakAtEnd && last && after.merge(0, toOff, last, true)) {
        content[content.length - 1] = after
      } else {
        // Remove the start of the after element, if necessary, and
        // add it to `content`.
        if (toOff || after.children.length && after.children[0].length == 0) after.merge(0, toOff, null, false)
        content.push(after)
      }
    } else if (after.breakAfter) {
      // The element at `toI` is entirely covered by this range.
      // Preserve its line break, if any.
      if (last) last.breakAfter = 1
      else breakAtStart = 1
    }
    // Since we've handled the next element from the current elements
    // now, make sure `toI` points after that.
    toI++

    before.breakAfter = breakAtStart
    if (fromOff > 0) {
      if (!breakAtStart && content.length && before.merge(fromOff, before.length, content[0], false)) {
        before.breakAfter = content.shift()!.breakAfter
      } else if (fromOff < before.length) {
        before.merge(fromOff, before.length, null, false)
      }
      fromI++
    }

    // Try to merge widgets on the boundaries of the replacement
    while (fromI < toI && content.length) {
      if (this.children[toI - 1].match(content[content.length - 1]))
        toI--, content.pop()
      else if (this.children[fromI].match(content[0]))
        fromI++, content.shift()
      else
        break
    }
    if (fromI < toI || content.length) this.replaceChildren(fromI, toI, content)
  }

  // Sync the DOM selection to this.state.selection
  updateSelection(takeFocus: boolean = false) {
    this.clearSelectionDirty()
    if (!takeFocus && this.root.activeElement != this.dom) return

    let primary = this.state.selection.primary
    // FIXME need to handle the case where the selection falls inside a block range
    let anchor = this.domAtPos(primary.anchor)
    let head = this.domAtPos(primary.head)

    let domSel = this.root.getSelection()!
    // If the selection is already here, or in an equivalent position, don't touch it
    if (this.forceSelectionUpdate ||
        !isEquivalentPosition(anchor.node, anchor.offset, domSel.anchorNode, domSel.anchorOffset) ||
        !isEquivalentPosition(head.node, head.offset, domSel.focusNode, domSel.focusOffset)) {
      this.forceSelectionUpdate = false

      this.observer.ignore(() => {
        // Selection.extend can be used to create an 'inverted' selection
        // (one where the focus is before the anchor), but not all
        // browsers support it yet.
        if (domSel.extend) {
          domSel.collapse(anchor.node, anchor.offset)
          if (!primary.empty) domSel.extend(head.node, head.offset)
        } else {
          let range = document.createRange()
          if (primary.anchor > primary.head) [anchor, head] = [head, anchor]
          range.setEnd(head.node, head.offset)
          range.setStart(anchor.node, anchor.offset)
          domSel.removeAllRanges()
          domSel.addRange(range)
        }
      })
    }

    this.impreciseAnchor = anchor.precise ? null : new DOMPos(domSel.anchorNode!, domSel.anchorOffset)
    this.impreciseHead = head.precise ? null: new DOMPos(domSel.focusNode!, domSel.focusOffset)
  }

  lineAt(pos: number, editorTop?: number): BlockInfo {
    if (editorTop == null) editorTop = this.dom.getBoundingClientRect().top
    return this.heightMap.lineAt(pos, QueryType.ByPos, this.state.doc, editorTop + this.paddingTop, 0)
  }

  lineAtHeight(height: number, editorTop?: number): BlockInfo {
    if (editorTop == null) editorTop = this.dom.getBoundingClientRect().top
    return this.heightMap.lineAt(height, QueryType.ByHeight, this.state.doc, editorTop + this.paddingTop, 0)
  }

  blockAtHeight(height: number, editorTop?: number): BlockInfo {
    if (editorTop == null) editorTop = this.dom.getBoundingClientRect().top
    return this.heightMap.blockAt(height, this.state.doc, editorTop + this.paddingTop, 0)
  }

  forEachLine(from: number, to: number, f: (line: BlockInfo) => void, editorTop?: number) {
    if (editorTop == null) editorTop = this.dom.getBoundingClientRect().top
    return this.heightMap.forEachLine(from, to, this.state.doc, editorTop + this.paddingTop, 0, f)
  }

  // Compute the new viewport and set of decorations, while giving
  // plugin views the opportunity to respond to state and viewport
  // changes. Might require more than one iteration to become stable.
  computeUpdate(state: EditorState, update: ViewUpdate | null, initializing: null | ((viewport: Viewport) => void),
                contentChanges: readonly ChangedRange[], viewportBias: number, scrollIntoView: number): readonly ChangedRange[] {
    for (let i = 0;; i++) {
      let viewport = this.viewportState.getViewport(state.doc, this.heightMap, viewportBias, scrollIntoView)
      let viewportChange = this.viewport ? !viewport.eq(this.viewport) : true
      // When the viewport is stable and no more iterations are needed, return
      if (!viewportChange && !update && !initializing) return contentChanges
      // After 5 tries, give up
      if (i == 5) {
        console.warn("Viewport and decorations failed to converge")
        return contentChanges
      }
      let prevState = this.state || state
      if (initializing) initializing(viewport)
      else this.view.updateInner(update || new ViewUpdate(this.view), viewport)

      // For the composition decoration, use none on init, recompute
      // when handling transactions, and use the previous value
      // otherwise.
      if (!this.view.inputState.composing) this.compositionDeco = Decoration.none
      else if (update && update.transactions.length) this.compositionDeco = computeCompositionDeco(this.view, contentChanges)
      let decorations = this.view.behavior(decorationsBehavior).concat(this.compositionDeco)
      // If the decorations are stable, stop.
      if (!update && !initializing && sameArray(decorations, this.decorations)) return contentChanges
      // Compare the decorations (between document changes)
      let {content, height} = decoChanges(update ? contentChanges : none,
                                          decorations, this.decorations, prevState.doc.length)
      this.decorations = decorations
      // Update the heightmap with these changes. If this is the first
      // iteration and the document changed, also include decorations
      // for inserted ranges.
      let heightChanges = extendWithRanges(none, height)
      if (update)
        heightChanges = extendWithRanges(heightChanges, heightRelevantDecorations(decorations, contentChanges))
      this.heightMap = this.heightMap.applyChanges(decorations, this.state.doc, this.heightOracle, heightChanges)
      // Accumulate content changes so that they can be redrawn
      contentChanges = extendWithRanges(contentChanges, content)
      // Make sure only one iteration is marked as required / state changing
      update = null
      initializing = null
    }
  }

  focus() {
    this.updateSelection(true)
  }

  cancelLayoutCheck() {
    if (this.layoutCheckScheduled > -1) {
      cancelAnimationFrame(this.layoutCheckScheduled)
      this.layoutCheckScheduled = -1
    }
  }

  checkLayout(forceFull = false) {
    this.cancelLayoutCheck()
    this.measureVerticalPadding()
    let scrollIntoView = Math.min(this.scrollIntoView, this.state.doc.length)
    this.scrollIntoView = -1
    let scrollBias = 0
    if (forceFull) this.viewportState.coverEverything()
    else scrollBias = this.viewportState.updateFromDOM(this.dom, this.paddingTop)
    if (this.viewportState.top >= this.viewportState.bottom) return // We're invisible!

    this.view.updateState = UpdateState.Measuring
    let lineHeights: number[] | null = this.measureVisibleLineHeights(), refresh = false
    if (this.heightOracle.mustRefresh(lineHeights)) {
      let {lineHeight, charWidth} = this.measureTextSize()
      refresh = this.heightOracle.refresh(getComputedStyle(this.dom).whiteSpace!,
                                          lineHeight, charWidth, (this.dom).clientWidth / charWidth, lineHeights)
      if (refresh) this.minWidth = 0
    }

    if (scrollIntoView > -1) this.scrollPosIntoView(scrollIntoView)

    let toMeasure: ViewPluginValue[] = []
    for (let plugin of this.view.behavior(viewPlugin)) {
      let value = this.view.plugin(plugin)!
      if (value.measure && value.drawMeasured) toMeasure.push(value)
    }
    
    let update = false, measure = toMeasure.map(plugin => plugin.measure!())
    for (let i = 0;; i++) {
      this.heightOracle.heightChanged = false
      this.heightMap = this.heightMap.updateHeight(
        this.heightOracle, 0, refresh, new MeasuredHeights(this.viewport.from, lineHeights || this.measureVisibleLineHeights()))
      let covered = this.viewportState.coveredBy(this.state.doc, this.viewport, this.heightMap, scrollBias)
      if (covered && !this.heightOracle.heightChanged) break
      this.view.updateState = UpdateState.Updating
      update = true
      if (i > 10) throw new Error("Layout failed to converge") // FIXME warn and break?
      let contentChanges = covered ? none : this.computeUpdate(this.state, null, null, none, scrollBias, -1)
      this.updateInner(contentChanges, this.length)
      lineHeights = null
      refresh = false
      scrollBias = 0
      this.view.updateState = UpdateState.Measuring
      this.viewportState.updateFromDOM(this.dom, this.paddingTop)
      measure = toMeasure.map(plugin => plugin.measure!())
    }
    this.view.updateState = UpdateState.Updating
    toMeasure.forEach((plugin, i) => plugin.drawMeasured!(measure![i]))
    if (update) {
      this.observer.listenForScroll()
      this.view.drawPlugins()
    }
    this.view.updateState = UpdateState.Idle
  }

  scrollPosIntoView(pos: number) {
    let rect = this.coordsAt(pos)
    if (rect) scrollRectIntoView(this.dom, rect)
  }

  nearest(dom: Node): ContentView | null {
    for (let cur: Node | null = dom; cur;) {
      let domView = cur.cmView
      if (domView && domView.rootView == this) return domView
      cur = cur.parentNode
    }
    return null
  }

  posFromDOM(node: Node, offset: number): number {
    let view = this.nearest(node)
    if (!view) throw new RangeError("Trying to find position for a DOM position outside of the document")
    return view.localPosFromDOM(node, offset) + view.posAtStart
  }

  domAtPos(pos: number): DOMPos {
    let {i, off} = this.childCursor().findPos(pos, -1)
    for (; i < this.children.length - 1;) {
      let child = this.children[i]
      if (off < child.length || child instanceof LineView) break
      i++; off = 0
    }
    return this.children[i].domAtPos(off)
  }

  coordsAt(pos: number): Rect | null {
    for (let off = this.length, i = this.children.length - 1;; i--) {
      let child = this.children[i], start = off - child.breakAfter - child.length
      if (pos >= start && child.type != BlockType.WidgetAfter) return child.coordsAt(pos - start)
      off = start
    }
  }

  measureVisibleLineHeights() {
    let result = [], {from, to} = this.viewport
    let minWidth = Math.max(this.dom.clientWidth, this.minWidth) + 1
    for (let pos = 0, i = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (end > to) break
      if (pos >= from) {
        result.push(child.dom!.getBoundingClientRect().height)
        let width = child.dom!.scrollWidth
        if (width > minWidth) {
          this.minWidth = minWidth = width
          this.minWidthFrom = pos
          this.minWidthTo = end
        }
      }
      pos = end + child.breakAfter
    }
    return result
  }

  measureVerticalPadding() {
    let style = window.getComputedStyle(this.dom)
    this.paddingTop = parseInt(style.paddingTop!) || 0
    this.paddingBottom = parseInt(style.paddingBottom!) || 0
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
    this.observer.ignore(() => {
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

  clearSelectionDirty() {
    if (this.selectionDirty != null) {
      cancelAnimationFrame(this.selectionDirty)
      this.selectionDirty = null
    }
  }

  setSelectionDirty() {
    this.observer.clearSelection()
    if (this.selectionDirty == null)
      this.selectionDirty = requestAnimationFrame(() => this.updateSelection())
  }

  childCursor(pos: number = this.length): ChildCursor {
    // Move back to start of last element when possible, so that
    // `ChildCursor.findPos` doesn't have to deal with the edge case
    // of being after the last element.
    let i = this.children.length
    if (i) pos -= this.children[--i].length
    return new ChildCursor(this.children, pos, i)
  }

  computeGapDeco(viewports: readonly Viewport[], docLength: number): DecorationSet {
    let deco = []
    for (let pos = 0, i = 0;; i++) {
      let next = i == viewports.length ? null : viewports[i]
      let end = next ? next.from - 1 : docLength
      if (end > pos) {
        let height = this.lineAt(end, 0).bottom - this.lineAt(pos, 0).top
        deco.push(Decoration.replace(pos, end, {widget: new GapWidget(height), block: true, inclusive: true}))
      }
      if (!next) break
      pos = next.to + 1
    }
    return Decoration.set(deco)
  }
}

// Browsers appear to reserve a fixed amount of bits for height
// styles, and ignore or clip heights above that. For Chrome and
// Firefox, this is in the 20 million range, so we try to stay below
// that.
const MAX_NODE_HEIGHT = 1e7

class GapWidget extends WidgetType<number> {
  toDOM() {
    let elt = document.createElement("div")
    this.updateDOM(elt)
    return elt
  }

  updateDOM(elt: HTMLElement) {
    if (this.value < MAX_NODE_HEIGHT) {
      while (elt.lastChild) elt.lastChild.remove()
      elt.style.height = this.value + "px"
    } else {
      elt.style.height = ""
      for (let remaining = this.value; remaining > 0; remaining -= MAX_NODE_HEIGHT) {
        let fill = elt.appendChild(document.createElement("div"))
        fill.style.height = Math.min(remaining, MAX_NODE_HEIGHT) + "px"
      }
    }
    return true
  }

  get estimatedHeight() { return this.value }
}

function decoChanges(diff: readonly ChangedRange[], decorations: readonly DecorationSet[],
                     oldDecorations: readonly DecorationSet[], oldLength: number): {content: number[], height: number[]} {
  let contentRanges: number[] = [], heightRanges: number[] = []
  for (let i = decorations.length - 1; i >= 0; i--) {
    let deco = decorations[i], oldDeco = i < oldDecorations.length ? oldDecorations[i] : Decoration.none
    if (deco.size == 0 && oldDeco.size == 0) continue
    let newRanges = findChangedRanges(oldDeco, deco, diff, oldLength)
    contentRanges = joinRanges(contentRanges, newRanges.content)
    heightRanges = joinRanges(heightRanges, newRanges.height)
  }
  return {content: contentRanges, height: heightRanges}
}

function extendWithRanges(diff: readonly ChangedRange[], ranges: number[]): readonly ChangedRange[] {
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

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function computeCompositionDeco(view: EditorView, changes: readonly ChangedRange[]): DecorationSet {
  let sel = view.root.getSelection()!
  let textNode = sel.focusNode && nearbyTextNode(sel.focusNode, sel.focusOffset)
  if (!textNode) return Decoration.none
  let cView = view.docView.nearest(textNode)
  let from: number, to: number, topNode = textNode
  if (cView instanceof InlineView) {
    from = cView.posAtStart
    to = from + cView.length
    topNode = cView.dom!
  } else if (cView instanceof LineView) {
    while (topNode.parentNode != cView.dom) topNode = topNode.parentNode!
    let prev = topNode.previousSibling
    while (prev && !prev.cmView) prev = prev.previousSibling
    from = to = prev ? prev.cmView!.posAtEnd : cView.posAtStart
  } else {
    return Decoration.none
  }

  let newFrom = ChangedRange.mapPos(from, 1, changes), newTo = Math.max(newFrom, ChangedRange.mapPos(to, -1, changes))
  let text = textNode.nodeValue!, doc = view.state.doc
  if (newTo - newFrom < text.length) {
    if (doc.slice(newFrom, Math.min(doc.length, newFrom + text.length)) == text) newTo = newFrom + text.length
    else if (doc.slice(Math.max(0, newTo - text.length), newTo) == text) newFrom = newTo - text.length
    else return Decoration.none
  } else if (doc.slice(newFrom, newTo) != text) {
    return Decoration.none
  }

  return Decoration.set(Decoration.replace(newFrom, newTo, {
    widget: new CompositionWidget({top: topNode, text: textNode})
  }))
}

class CompositionWidget extends WidgetType<{top: Node, text: Node}> {
  eq(value: {top: Node, text: Node}) { return this.value.top == value.top && this.value.text == value.text }

  toDOM() { return this.value.top as HTMLElement }

  ignoreEvent() { return false }

  get customView() { return CompositionView }
}

function nearbyTextNode(node: Node, offset: number): Node | null {
  for (;;) {
    if (node.nodeType == 3) return node
    if (node.nodeType == 1 && offset > 0) {
      node = node.childNodes[offset - 1]
      offset = maxOffset(node)
    } else if (node.nodeType == 1 && offset < node.childNodes.length) {
      node = node.childNodes[offset]
      offset = 0
    } else {
      return null
    }
  }
}
