import {ContentView, ChildCursor, DocChildCursor, dirty} from "./contentview"
import {BlockView, LineView} from "./blockview"
import {TextView, CompositionView} from "./inlineview"
import {ContentBuilder} from "./buildview"
import {Viewport, ViewportState} from "./viewport"
import browser from "./browser"
import {DOMObserver} from "./domobserver"
import {HeightMap, QueryType, HeightOracle, MeasuredHeights, BlockInfo} from "./heightmap"
import {Decoration, DecorationSet, joinRanges, findChangedRanges, heightRelevantDecorations, WidgetType, BlockType} from "./decoration"
import {clientRectsFor, isEquivalentPosition, scrollRectIntoView, maxOffset, Rect} from "./dom"
import {ViewUpdate, ViewSnapshot, ViewField} from "./extension"
import {EditorView} from "./editorview"
import {EditorState, ChangeSet, ChangedRange, Transaction} from "../../state/src"
import {Slot} from "../../extension/src/extension"
import {Text} from "../../doc/src"

type A<T> = ReadonlyArray<T>
const none = [] as any

const enum Composing { no, starting, yes, ending }

export class DocView extends ContentView {
  children!: BlockView[]
  viewports: Viewport[] = none

  decorations!: A<DecorationSet>
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

  composing: Composing = Composing.no
  composition: CompositionView | null = null
  composeTimeout: any = -1

  paddingTop: number = 0
  paddingBottom: number = 0

  dom!: HTMLElement

  get length() { return this.state.doc.length }

  get state() { return this.view.state }

  get viewport() { return this.view.viewport }

  get root() { return this.view.root }

  constructor(private view: EditorView, onDOMChange: (from: number, to: number, typeOver: boolean) => boolean) {
    super()
    this.setDOM(view.contentDOM)

    this.viewportState = new ViewportState
    this.observer = new DOMObserver(this, onDOMChange, () => this.checkLayout())
  }

  init(state: EditorState) {
    let changedRanges = [new ChangedRange(0, 0, 0, state.doc.length)]
    this.heightMap = HeightMap.empty().applyChanges(none, Text.empty, this.heightOracle.setDoc(state.doc), changedRanges)
    this.children = [new LineView]
    this.children[0].setParent(this)
    this.viewports = this.decorations = none
    let contentChanges = this.computeUpdate(null, state, none, changedRanges, 0, -1)
    this.updateInner(contentChanges, 0)
    this.cancelLayoutCheck()
    this.layoutCheckScheduled = requestAnimationFrame(() => this.checkLayout())
  }

  // Update the document view to a given state. scrollIntoView can be
  // used as a hint to compute a new viewport that includes that
  // position, if we know the editor is going to scroll that position
  // into view.
  update(transactions: A<Transaction>, state: EditorState, metadata: Slot[], scrollIntoView: number = -1) {
    // FIXME need some way to stabilize viewport—if a change causes the
    // top of the visible viewport to move, scroll position should be
    // adjusted to keep the content in place

    let prevDoc = this.state.doc
    let changes = transactions.length == 1 ? transactions[0].changes :
      transactions.reduce((chs, tr) => chs.appendSet(tr.changes), ChangeSet.empty)
    let changedRanges = changes.changedRanges()
    // When the DOM nodes around the selection are moved to another
    // parent, Chrome sometimes reports a different selection through
    // getSelection than the one that it actually shows to the user.
    // This forces a selection update when lines are joined to work
    // around that. Issue #54
    if (browser.chrome && !this.composition && changes.changes.some(ch => ch.text.length > 1))
      this.forceSelectionUpdate = true
    this.heightMap = this.heightMap.applyChanges(none, prevDoc, this.heightOracle.setDoc(state.doc), changedRanges)

    let contentChanges = this.computeUpdate(transactions, state, metadata, changedRanges, 0, scrollIntoView)

    if (this.dirty == dirty.not && contentChanges.length == 0 &&
        this.state.selection.primary.from >= this.viewport.from &&
        this.state.selection.primary.to <= this.viewport.to) {
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
  private updateInner(changes: A<ChangedRange>, oldLength: number) {
    changes = this.commitComposition(changes)

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

    let compositionRange = null
    // FIXME changes also contains decoration changes, so this could
    // interrupt compositions due to styling updates (such as highlighting)
    // FIXME we do want to interrupt compositions when they overlap
    // with collapsed decorations (not doing so will break rendering
    // code further down, since the decorations aren't drawn in one piece)
    if (this.composition && this.composition.rootView == this) {
      let from = this.composition.posAtStart, to = from + this.composition.length
      let newFrom = ChangedRange.mapPos(from, -1, changes), newTo = ChangedRange.mapPos(to, 1, changes)
      if (changes.length == 0 || changes.length == 1 &&
          changes[0].fromA >= from && changes[0].toA <= to &&
          this.composition.textDOM.nodeValue == this.state.doc.slice(newFrom, newTo)) {
        // No change, or the change falls entirely inside the
        // composition and the new text corresponds to what the
        // composition DOM contains
        compositionRange = new ChangedRange(from, to, from, to + (changes.length ? changes[0].lenDiff : 0))
      } else if (changes.every(ch => ch.fromA >= to || ch.toA <= from)) {
        // Entirely outside
        compositionRange = new ChangedRange(from, to, newFrom, newFrom + (to - from))
      } else {
        // Overlaps with the composition, must make sure it is
        // overwritten so that we get rid of the node
        changes = new ChangedRange(from, to, newFrom, newTo).addToSet(changes.slice())
        this.composition = null
      }
    }

    this.updateChildren(changes, viewports, compositionRange, oldLength)

    this.viewports = viewports
    this.observer.ignore(() => {
      // Lock the height during redrawing, since Chrome sometimes
      // messes with the scroll position during DOM mutation (though
      // no relayout is triggered and I cannot imagine how it can
      // recompute the scroll position without a layout)
      this.dom.style.height = this.heightMap.height + "px"
      this.sync()
      this.dirty = dirty.not
      this.updateSelection()
      this.dom.style.height = ""
    })

    if (this.composition && this.composition.rootView != this) this.composition = null
  }

  private updateChildren(changes: A<ChangedRange>, viewports: A<Viewport>, compositionRange: ChangedRange | null, oldLength: number) {
    if (compositionRange) changes = compositionRange.subtractFromSet(changes.slice())

    let gapDeco = this.computeGapDeco(viewports, this.length)
    let gapChanges = findChangedRanges(this.gapDeco, gapDeco, changes, oldLength) // FIXME pass original, possibly simpler changes?
    this.gapDeco = gapDeco
    changes = extendWithRanges(changes, gapChanges.content)

    let allDeco = [gapDeco].concat(this.decorations)
    let cursor = this.childCursor(oldLength), updatedComposition = false
    for (let i = changes.length - 1;; i--) {
      let next = i >= 0 ? changes[i] : null, nextA = next ? next.toA : 0
      if (compositionRange && !updatedComposition && nextA <= compositionRange.fromA) {
        cursor.findPos(nextA) // Must move cursor past the stuff we modify
        this.composition!.updateLength(compositionRange.toB - compositionRange.fromB)
        updatedComposition = true
      }
      if (!next) break
      let {fromA, toA, fromB, toB} = next
      let {content, breakAtStart} = ContentBuilder.build(this.state.doc, fromB, toB, allDeco)
      let {i: toI, off: toOff} = cursor.findPos(toA, 1)
      let {i: fromI, off: fromOff} = cursor.findPos(fromA, -1)
      if (compositionRange && this.composition!.parent == this.children[toI] &&
          content[content.length - 1] instanceof LineView)
        (this.children[toI] as LineView).transferDOM(content[content.length - 1] as LineView)
      this.replaceRange(fromI, fromOff, toI, toOff, content, breakAtStart)
    }
  }

  private replaceRange(fromI: number, fromOff: number, toI: number, toOff: number,
                       content: BlockView[], breakAtStart: number) {
    let before = this.children[fromI], last = content.length ? content[content.length - 1] : null
    let breakAtEnd = last ? last.breakAfter : breakAtStart
    // Change within a single line
    if (fromI == toI && !breakAtStart && !breakAtEnd && content.length < 2 &&
        before.merge(fromOff, toOff, content.length ? last : null, fromOff == 0, this.composition))
      return

    let after = this.children[toI]
    if (toOff < after.length) {
      if (fromI == toI) {
        after = after.split(toOff)
        toOff = 0
      }
      if (!breakAtEnd && last && after.merge(0, toOff, last, true, this.composition)) {
        content[content.length - 1] = after
      } else {
        if (toOff) after.merge(0, toOff, null, false, this.composition)
        content.push(after)
      }
    } else if (after.breakAfter) {
      if (last) last.breakAfter = 1
      else breakAtStart = 1
    }
    toI++

    before.breakAfter = breakAtStart
    if (fromOff > 0) {
      if (!breakAtStart && content.length && before.merge(fromOff, before.length, content[0], false, this.composition)) {
        before.breakAfter = content.shift()!.breakAfter
      } else if (fromOff < before.length) {
        before.merge(fromOff, before.length, null, false, this.composition)
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
    let anchor = this.domFromPos(primary.anchor)!
    let head = this.domFromPos(primary.head)!

    let domSel = this.root.getSelection()!
    // If the selection is already here, or in an equivalent position, don't touch it
    if (!this.forceSelectionUpdate &&
        isEquivalentPosition(anchor.node, anchor.offset, domSel.anchorNode, domSel.anchorOffset) &&
        isEquivalentPosition(head.node, head.offset, domSel.focusNode, domSel.focusOffset))
      return

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

  lineAt(pos: number, editorTop?: number): BlockInfo {
    if (editorTop == null) editorTop = this.dom.getBoundingClientRect().top
    return this.heightMap.lineAt(pos, QueryType.byPos, this.state.doc, editorTop + this.paddingTop, 0)
  }

  lineAtHeight(height: number, editorTop?: number): BlockInfo {
    if (editorTop == null) editorTop = this.dom.getBoundingClientRect().top
    return this.heightMap.lineAt(height, QueryType.byHeight, this.state.doc, editorTop + this.paddingTop, 0)
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
  // Passing update == null means the state didn't change
  computeUpdate(trs: A<Transaction> | null, // Null means we're initializing
                state: EditorState, metadata: Slot[], contentChanges: A<ChangedRange>,
                viewportBias: number, scrollIntoView: number): A<ChangedRange> {
    let init = trs == null, transactions = trs || none
    for (let i = 0;; i++) {
      let viewport = this.viewportState.getViewport(state.doc, this.heightMap, viewportBias, scrollIntoView)
      let viewportChange = this.viewport ? !viewport.eq(this.viewport) : true
      // After 5 tries, or when the viewport is stable and no more iterations are needed, return
      if (i == 5 || !(init || viewportChange || transactions.length || metadata.length)) {
        if (i == 5) console.warn("Viewport and decorations failed to converge")
        return contentChanges
      }
      let prevState = this.state || state
      this.view.updateStateInner(state, viewport, transactions, metadata)

      let decorations = this.view.getEffect(ViewField.decorationEffect)
      // If the decorations are stable, stop.
      if (!init && transactions.length == 0 && sameArray(decorations, this.decorations))
        return contentChanges
      // Compare the decorations (between document changes)
      let {content, height} = decoChanges(init || transactions.length ? contentChanges : none, decorations,
                                          this.decorations, prevState.doc.length)
      this.decorations = decorations
      // Update the heightmap with these changes. If this is the first
      // iteration and the document changed, also include decorations
      // for inserted ranges.
      let heightChanges = extendWithRanges(none, height)
      if (init || transactions.length)
        heightChanges = extendWithRanges(heightChanges, heightRelevantDecorations(decorations, contentChanges))
      this.heightMap = this.heightMap.applyChanges(decorations, this.state.doc, this.heightOracle, heightChanges)
      // Accumulate content changes so that they can be redrawn
      contentChanges = extendWithRanges(contentChanges, content)
      // Make sure only one iteration is marked as required / state changing
      transactions = metadata = none
      init = false
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

  forceLayout() {
    if (this.layoutCheckScheduled > -1 && !this.view.updating) this.checkLayout()
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

    let lineHeights: number[] | null = this.measureVisibleLineHeights(), refresh = false
    if (this.heightOracle.mustRefresh(lineHeights)) {
      let {lineHeight, charWidth} = this.measureTextSize()
      refresh = this.heightOracle.refresh(getComputedStyle(this.dom).whiteSpace!,
                                          lineHeight, charWidth, (this.dom).clientWidth / charWidth, lineHeights)
    }

    if (scrollIntoView > -1) this.scrollPosIntoView(scrollIntoView)

    this.view.withUpdating(() => {
      let updated: ViewSnapshot | null = null
      for (let i = 0;; i++) {
        this.heightOracle.heightChanged = false
        this.heightMap = this.heightMap.updateHeight(
          this.heightOracle, 0, refresh, new MeasuredHeights(this.viewport.from, lineHeights || this.measureVisibleLineHeights()))
        let covered = this.viewportState.coveredBy(this.state.doc, this.viewport, this.heightMap, scrollBias)
        if (covered && !this.heightOracle.heightChanged) break
        if (!updated) updated = new ViewSnapshot(this.view)
        if (i > 10) throw new Error("Layout failed to converge")
        let contentChanges = covered ? none : this.computeUpdate(none, this.state, none, none, scrollBias, -1)
        this.updateInner(contentChanges, this.length)
        lineHeights = null
        refresh = false
        scrollBias = 0
        this.viewportState.updateFromDOM(this.dom, this.paddingTop)
      }
      if (updated) {
        this.observer.listenForScroll()
        this.view.updatePlugins(new ViewUpdate(updated, none, this.view, none))
      }
    })
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

  domFromPos(pos: number): {node: Node, offset: number} | null {
    let {i, off} = this.childCursor().findPos(pos)
    for (;; i--) {
      let child = this.children[i]
      if (child instanceof LineView) return child.domFromPos(off)
      if (child.type == BlockType.widgetRange || i == 0) return null
    }
  }

  coordsAt(pos: number): Rect | null {
    for (let off = this.length, i = this.children.length - 1;; i--) {
      let child = this.children[i], start = off - child.breakAfter - child.length
      if (pos >= start && child.type != BlockType.widgetAfter) return child.coordsAt(pos - start)
      off = start
    }
  }

  measureVisibleLineHeights() {
    let result = [], {from, to} = this.viewport
    for (let pos = 0, i = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length + child.breakAfter
      if (end > to) break
      if (pos >= from) result.push(child.dom!.getBoundingClientRect().height)
      pos = end
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

  startComposition() {
    if (this.composing == Composing.ending) {
      this.observer.flush()
      if (this.composing == Composing.ending) {
        clearTimeout(this.composeTimeout)
        this.exitComposition()
      }
    }
    if (this.composing == Composing.no) {
      this.composing = Composing.starting
      this.composeTimeout = setTimeout(() => this.enterComposition(), 20)
    }
  }

  endComposition() {
    if (this.composing == Composing.yes) {
      this.composing = Composing.ending
      this.composeTimeout = setTimeout(() => this.exitComposition(), 20)
    } else if (this.composing == Composing.starting) {
      clearTimeout(this.composeTimeout)
      this.composing = Composing.no
    }
  }

  commitComposition(changes: A<ChangedRange>): A<ChangedRange> {
    if (this.composing == Composing.starting) {
      clearTimeout(this.composeTimeout)
      this.enterComposition()
    } else if (this.composing == Composing.ending) {
      clearTimeout(this.composeTimeout)
      changes = this.clearComposition(changes)
    }
    return changes
  }

  enterComposition() {
    // FIXME schedule a timeout that ends the composition (or at least
    // our view of it) after a given inactive time?
    let {focusNode, focusOffset} = this.root.getSelection()!
    if (focusNode) {
      // Enter adjacent nodes when necessary, looking for a text node
      while (focusNode.nodeType == 1) {
        if (focusOffset > 0) {
          focusNode = focusNode.childNodes[focusOffset - 1]
          focusOffset = maxOffset(focusNode)
        } else if (focusOffset < focusNode.childNodes.length) {
          focusNode = focusNode.childNodes[focusOffset]
          focusOffset = 0
        } else {
          break
        }
      }
      let view = this.nearest(focusNode)
      if (view instanceof TextView)
        this.composition = view.toCompositionView()
      else if (focusNode.nodeType == 3 && view instanceof LineView)
        this.composition = view.createCompositionViewAround(focusNode)
    }
    this.composing = this.composition ? Composing.yes : Composing.no
  }

  // Remove this.composition, if present, and set this.composing to
  // no. Return a range that covers the composition's extent (which'll
  // have to be redrawn to turn it into regular view nodes) when a
  // composition was removed.
  clearComposition(changes: A<ChangedRange>): A<ChangedRange> {
    let composition = this.composition
    this.composition = null
    this.composing = Composing.no
    if (composition && composition.rootView == this) {
      let from = composition.posAtStart, to = from + composition.length
      changes = new ChangedRange(from, to, ChangedRange.mapPos(from, -1, changes),
                                 ChangedRange.mapPos(to, 1, changes)).addToSet(changes.slice())
    }
    return changes
  }

  exitComposition() {
    let ranges = this.clearComposition(none)
    if (ranges.length) this.observer.ignore(() => {
      this.updateInner(ranges, this.length)
    })
  }

  childCursor(pos: number = this.length, i: number = this.children.length): ChildCursor {
    return new DocChildCursor(this.children, pos, i)
  }

  computeGapDeco(viewports: A<Viewport>, docLength: number): DecorationSet {
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

function decoChanges(diff: A<ChangedRange>, decorations: A<DecorationSet>,
                     oldDecorations: A<DecorationSet>, oldLength: number): {content: number[], height: number[]} {
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

function extendWithRanges(diff: A<ChangedRange>, ranges: number[]): A<ChangedRange> {
  if (ranges.length == 0) return diff
  let result: ChangedRange[] = []
  for (let dI = 0, rI = 0, posA = 0, posB = 0;; dI++) {
    let next = dI == diff.length ? null : diff[dI], off = posA - posB
    let end = next ? next.fromB : 2e9
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

function sameArray<T>(a: A<T>, b: A<T>) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
