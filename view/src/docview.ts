import {ContentView, ChildCursor, dirty} from "./contentview"
import {LineView} from "./lineview"
import {TextView, CompositionView} from "./inlineview"
import {ContentBuilder} from "./buildview"
import {Viewport, ViewportState} from "./viewport"
import browser from "./browser"
import {Text} from "../../doc/src"
import {DOMObserver} from "./domobserver"
import {EditorState, ChangeSet, ChangedRange, Transaction} from "../../state/src"
import {HeightMap, HeightOracle, MeasuredHeights, LineHeight} from "./heightmap"
import {Decoration, DecorationSet, joinRanges, findChangedRanges, heightRelevantDecorations} from "./decoration"
import {clientRectsFor, isEquivalentPosition, scrollRectIntoView, maxOffset} from "./dom"
import {ViewFields, ViewUpdate, decorationSlot} from "./extension"

type A<T> = ReadonlyArray<T>
const none = [] as any

const enum Composing { no, starting, yes, ending }

export class DocView extends ContentView {
  children: (LineView | GapView)[] = []
  viewports: Viewport[] = none

  fields!: ViewFields
  decorations!: A<DecorationSet>
  selectionDirty: any = null

  observer: DOMObserver
  forceSelectionUpdate: boolean = false

  viewportState: ViewportState
  heightMap!: HeightMap
  heightOracle: HeightOracle = new HeightOracle
  computingFields = false

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

  get state() { return this.fields.state }

  get viewport() { return this.fields.viewport }

  get childGap() { return 1 }

  constructor(dom: HTMLElement, public root: DocumentOrShadowRoot, private callbacks: {
    // FIXME These suggest that the strict separation between docview and editorview isn't really working
    updateFields: (state: EditorState, viewport: Viewport, transactions: A<Transaction>) => ViewFields,
    onDOMChange: (from: number, to: number, typeOver: boolean) => boolean,
    onUpdateDOM: (update: ViewUpdate) => void,
    onInitDOM: () => void
  }) {
    super()
    this.setDOM(dom)

    this.viewportState = new ViewportState
    this.observer = new DOMObserver(this, callbacks.onDOMChange, () => this.checkLayout())
  }

  init(state: EditorState) {
    let changedRanges = [new ChangedRange(0, 0, 0, state.doc.length)]
    this.heightMap = HeightMap.empty().applyChanges(none, this.heightOracle.setDoc(state.doc), changedRanges)
    this.children = []
    this.viewports = this.decorations = none
    let contentChanges = this.computeFields(none, state, changedRanges, 0, -1)
    this.updateInner(contentChanges, 0)
    this.cancelLayoutCheck()
    this.callbacks.onInitDOM()
    this.layoutCheckScheduled = requestAnimationFrame(() => this.checkLayout())
  }

  // Update the document view to a given state. scrollIntoView can be
  // used as a hint to compute a new viewport that includes that
  // position, if we know the editor is going to scroll that position
  // into view.
  update(transactions: A<Transaction>, state: EditorState, scrollIntoView: number = -1) {
    // FIXME need some way to stabilize viewport—if a change causes the
    // top of the visible viewport to move, scroll position should be
    // adjusted to keep the content in place

    let prevFields = this.fields
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
    this.heightMap = this.heightMap.applyChanges(none, this.heightOracle.setDoc(state.doc), changedRanges)

    let contentChanges = this.computeFields(transactions, state, changedRanges, 0, scrollIntoView)

    if (this.dirty == dirty.not && contentChanges.length == 0 &&
        this.state.selection.primary.from >= this.viewport.from &&
        this.state.selection.primary.to <= this.viewport.to) {
      this.updateSelection()
      if (scrollIntoView > -1) this.scrollPosIntoView(scrollIntoView)
    } else {
      this.updateInner(contentChanges, prevFields.state.doc.length)
      this.cancelLayoutCheck()
      this.callbacks.onUpdateDOM(new ViewUpdate(transactions, prevFields, this.fields))
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
    if (head < visible.from || head > visible.to)
      viewports.push(this.heightMap.lineViewport(head, this.state.doc))
    if (!viewports.some(({from, to}) => anchor >= from && anchor <= to))
      viewports.push(this.heightMap.lineViewport(anchor, this.state.doc))
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

    this.updateParts(changes, viewports, compositionRange, oldLength)

    this.viewports = viewports
    this.observer.ignore(() => {
      // Lock the height during redrawing, since Chrome sometimes
      // messes with the scroll position during DOM mutation (though
      // no relayout is triggered and I cannot imagine how it can
      // recompute the scroll position without a layout)
      this.dom.style.height = this.heightMap.height + "px"
      this.sync()
      this.updateSelection()
      this.dom.style.height = ""
    })

    if (this.composition && this.composition.rootView != this) this.composition = null
  }

  private updateParts(changes: A<ChangedRange>, viewports: A<Viewport>, compositionRange: ChangedRange | null,
                      oldLength: number) {
    let redraw = rangesToUpdate(this.viewports, viewports, changes, this.length)
    if (compositionRange) compositionRange.subtractFromSet(redraw)
    let cursor = new ChildCursor(this.children, oldLength, 1)
    for (let i = redraw.length - 1, posA = this.length;; i--) {
      let next = i < 0 ? null : redraw[i], nextA = next ? next.toA : 0
      if (compositionRange && compositionRange.fromA <= posA && compositionRange.toA >= nextA) {
        cursor.findPos(nextA) // Must move cursor past the stuff we modify
        this.composition!.updateLength(compositionRange.toB - compositionRange.fromB)
      }
      if (!next) break
      let {fromA, toA, fromB, toB} = next
      posA = fromA
      if (fromA == toA && fromB == toB && !changes.some(ch => fromB <= ch.toB && toB >= ch.fromB))
        continue

      let fromI, fromOff, toI: number, toOff
      if (toA == oldLength) { toI = this.children.length; toOff = -1 }
      else ({i: toI, off: toOff} = cursor.findPos(toA))
      if (fromA == 0) { fromI = 0; fromOff = -1 }
      else ({i: fromI, off: fromOff} = cursor.findPos(fromA))
      let searchGap = fromI, content = this.contentBetween(fromB, toB, viewports, (from, to) => {
        let height = this.heightAt(to, 1) - this.heightAt(from, -1)
        while (searchGap < toI) {
          let ch = this.children[searchGap++]
          if (ch instanceof GapView) return ch.update(to - from, height)
        }
        return new GapView(to - from, height)
      })
      // If the range starts at the start of the document but both
      // the current content and the new content start with a line
      // view, reuse that to avoid a needless DOM reset.
      if (fromOff == -1 && this.children[fromI] instanceof LineView && content[0] instanceof LineView)
        fromOff = 0
      if (toOff == -1 && toI > 0 && this.children[toI - 1] instanceof LineView &&
          content[content.length - 1] instanceof LineView)
        toOff = this.children[--toI].length
      if (compositionRange && toOff > -1 && this.composition!.parent == this.children[toI])
        (this.children[toI] as LineView).transferDOM(content[content.length - 1] as LineView)
      this.replaceRange(fromI, fromOff, toI, toOff, content)
    }
  }

  private contentBetween(from: number, to: number, viewports: A<Viewport>,
                         mkGap: (from: number, to: number) => GapView): (GapView | LineView)[] {
    let result: (GapView | LineView)[] = []
    for (let i = 0, pos = 0; pos <= to; i++) {
      let next = i < viewports.length ? viewports[i] : null
      let start = next ? next.from : this.length
      if (pos < to && start > from)
        // Gap are always entirely in range because of the way this is
        // called (between unchanged slices of text)
        result.push(mkGap(pos + (i > 0 ? 1 : 0), start - (next ? 1 : 0)))
      if (!next) break
      let vpFrom = Math.max(from, next.from), vpTo = Math.min(to, next.to)
      if (vpFrom <= vpTo) {
        let content = ContentBuilder.build(this.state.doc, vpFrom, vpTo, this.decorations)
        if (result.length == 0) result = content
        else for (let line of content) result.push(line)
      }
      pos = next.to
    }
    return result
  }

  // Update a range by replacing it with new content. The caller is
  // responsible for making sure that the inserted content 'fits'—that
  // nodes on the sides match the type (gap or line) of the existing
  // nodes there.
  // When *Off is -1, that means "this points at the position before
  // *I, not actually into an existing node"
  private replaceRange(fromI: number, fromOff: number, toI: number, toOff: number,
                       content: (GapView | LineView)[]) {
    let start = fromOff > -1 ? this.children[fromI] as LineView : null
    if (start && fromI == toI && content.length == 1) { // Change within single child
      start.merge(fromOff, toOff, content[0] as LineView, fromOff == 0)
    } else {
      let end = toOff > -1 ? this.children[toI] as LineView : null
      if (end) {
        let cLast = content[content.length - 1] as LineView, endPart = end
        if (toOff > 0 || fromI == toI) {
          endPart = end.split(toOff)
          if (fromI != toI) end.transferDOM(endPart)
        }
        cLast.merge(cLast.length, cLast.length, endPart, false)
        toI++
      }
      if (start) {
        start.merge(fromOff, start.length, content[0] as LineView, fromOff == 0)
        fromI++
        content.shift()
      }
      if (fromI < toI || content.length)
        this.replaceChildren(fromI, toI, content)
    }
  }

  // Sync the DOM selection to this.state.selection
  updateSelection(takeFocus: boolean = false) {
    this.clearSelectionDirty()
    if (!takeFocus && this.root.activeElement != this.dom) return

    let primary = this.state.selection.primary
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

  heightAt(pos: number, bias: 1 | -1) {
    return this.heightMap.heightAt(pos, this.state.doc, bias) + this.paddingTop
  }

  lineAtHeight(height: number): LineHeight {
    return this.heightMap.lineAt(height - this.paddingTop, this.state.doc)
  }

  // Compute the new viewport and set of decorations, while giving
  // plugin views the opportunity to respond to state and viewport
  // changes. Might require more than one iteration to become stable.
  // Passing update == null means the state didn't change
  computeFields(transactions: A<Transaction>, state: EditorState,
                contentChanges: A<ChangedRange> = none,
                bias: number, scrollIntoView: number): A<ChangedRange> {
    try {
      this.computingFields = true
      let result = this.computeFieldsInner(transactions, state, contentChanges, bias, scrollIntoView)
      // FIXME public mutable viewport should probably work differently
      return result
    } finally {
      this.computingFields = false
    }
  }

  computeFieldsInner(transactions: A<Transaction>, state: EditorState,
                     contentChanges: A<ChangedRange> = none,
                     bias: number, scrollIntoView: number): A<ChangedRange> {
    for (let i = 0;; i++) {
      let viewport = this.viewportState.getViewport(state.doc, this.heightMap, bias, scrollIntoView)
      let viewportChange = this.fields ? !viewport.eq(this.fields.viewport) : true
      // After 5 tries, or when the viewport is stable and no more iterations are needed, return
      if (i == 5 || !(transactions.length || viewportChange)) {
        if (transactions.length || viewportChange) console.warn("Viewport and decorations failed to converge")
        return contentChanges
      }
      let prevState = this.fields ? this.fields.state : state
      this.fields = this.callbacks.updateFields(state, viewport, transactions)

      let decorations = decorationSlot.get(this.fields)
      // If the decorations are stable, stop.
      if (transactions.length == 0 && sameArray(decorations, this.decorations))
        return contentChanges
      // Compare the decorations (between document changes)
      let {content, height} = decoChanges(transactions.length ? contentChanges : none, decorations,
                                          this.decorations, prevState.doc)
      this.decorations = decorations
      // Update the heightmap with these changes. If this is the first
      // iteration and the document changed, also include decorations
      // for inserted ranges.
      let heightChanges = extendWithRanges(none, height)
      if (transactions.length) heightChanges = extendWithRanges(heightChanges, heightRelevantDecorations(decorations, contentChanges))
      this.heightMap = this.heightMap.applyChanges(decorations, this.heightOracle, heightChanges)
      // Accumulate content changes so that they can be redrawn
      contentChanges = extendWithRanges(contentChanges, content)
      // Make sure only one iteration is marked as required / state changing
      transactions = none
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
    if (this.layoutCheckScheduled > -1 && !this.computingFields) this.checkLayout()
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

    let updated = false, prevFields = this.fields
    for (let i = 0;; i++) {
      this.heightOracle.heightChanged = false
      this.heightMap = this.heightMap.updateHeight(
        this.heightOracle, 0, refresh, new MeasuredHeights(this.viewport.from, lineHeights || this.measureVisibleLineHeights()))
      let covered = this.viewportState.coveredBy(this.state.doc, this.viewport, this.heightMap, scrollBias)
      if (covered && !this.heightOracle.heightChanged) break
      updated = true
      if (i > 10) throw new Error("Layout failed to converge")
      let contentChanges = covered ? none : this.computeFields(none, this.state, none, scrollBias, -1)
      this.updateInner(contentChanges, this.length)
      lineHeights = null
      refresh = false
      scrollBias = 0
      this.viewportState.updateFromDOM(this.dom, this.paddingTop)
    }
    if (updated) {
      this.observer.listenForScroll()
      this.callbacks.onUpdateDOM(new ViewUpdate(none, prevFields, this.fields))
    }
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
    let {i, off} = new ChildCursor(this.children, this.length, 1).findPos(pos)
    return this.children[i].domFromPos(off)
  }

  measureVisibleLineHeights() {
    let result = [], {from, to} = this.viewport
    for (let pos = 0, i = 0; pos <= to && i < this.children.length; i++) {
      let child = this.children[i] as LineView
      if (pos >= from) {
        result.push(child.dom!.getBoundingClientRect().height)
        let before = 0, after = 0
        for (let w of child.widgets) {
          let h = w.dom!.getBoundingClientRect().height
          if (w.side > 0) after += h
          else before += h
        }
        if (before) result.push(-2, before)
        if (after) result.push(-1, after)
      }
      pos += child.length + 1
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
}

// Browsers appear to reserve a fixed amount of bits for height
// styles, and ignore or clip heights above that. For Chrome and
// Firefox, this is in the 20 million range, so we try to stay below
// that.
const MAX_NODE_HEIGHT = 1e7

export class GapView extends ContentView {
  dom!: HTMLElement | null
  parent!: DocView | null

  constructor(public length: number, public height: number) { super() }

  get children() { return none }

  update(length: number, height: number) {
    this.length = length
    if (this.height != height) {
      this.height = height
      this.markDirty()
    }
    return this
  }

  syncInto(parent: HTMLElement, pos: Node | null): Node | null {
    if (!this.dom) {
      this.setDOM(document.createElement("div"))
      this.dom!.contentEditable = "false"
    }
    return super.syncInto(parent, pos)
  }

  sync() {
    if (this.dirty) {
      if (this.height < MAX_NODE_HEIGHT) {
        this.dom!.style.height = this.height + "px"
        while (this.dom!.firstChild) (this.dom!.firstChild as HTMLElement).remove()
      } else {
        this.dom!.style.height = ""
        while (this.dom!.firstChild) (this.dom!.firstChild as HTMLElement).remove()
        for (let remaining = this.height; remaining > 0; remaining -= MAX_NODE_HEIGHT) {
          let elt = this.dom!.appendChild(document.createElement("div"))
          elt.style.height = Math.min(remaining, MAX_NODE_HEIGHT) + "px"
        }
      }
      this.dirty = dirty.not
    }
  }

  get overrideDOMText() {
    return this.parent ? this.parent!.state.doc.sliceLines(this.posAtStart, this.posAtEnd) : [""]
  }

  domBoundsAround() { return null }
}

function decoChanges(diff: A<ChangedRange>, decorations: A<DecorationSet>,
                     oldDecorations: A<DecorationSet>, oldDoc: Text): {content: number[], height: number[]} {
  let contentRanges: number[] = [], heightRanges: number[] = []
  for (let i = decorations.length - 1; i >= 0; i--) {
    let deco = decorations[i], oldDeco = i < oldDecorations.length ? oldDecorations[i] : Decoration.none
    if (deco.size == 0 && oldDeco.size == 0) continue
    let newRanges = findChangedRanges(oldDeco, deco, diff, oldDoc)
    contentRanges = joinRanges(contentRanges, newRanges.content)
    heightRanges = joinRanges(heightRanges, newRanges.height)
  }
  return {content: contentRanges, height: heightRanges}
}

function extendWithRanges(diff: A<ChangedRange>, ranges: number[]): A<ChangedRange> {
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

function nextRange(viewports: A<Viewport>, pos: number): [boolean, number] {
  for (let i = 0; i < viewports.length; i++) {
    let {from, to} = viewports[i]
    if (from > pos) return [false, from]
    if (to > pos) return [true, to]
  }
  return [false, 2e9]
}

// Grows a set of ranges to include anything that wasn't drawn (as
// lines) in both the old and new viewports.
function rangesToUpdate(vpA: A<Viewport>, vpB: A<Viewport>, changes: A<ChangedRange>,
                        lenB: number): ChangedRange[]  {
  for (let i = 0, posA = 0, posB = 0, found: ChangedRange[] = [];; i++) {
    let change = i < changes.length ? changes[i] : null
    let nextB = change ? change.fromB : lenB
    // Unchanged range posB to nextB
    while (posB < nextB) {
      let [insideA, toA] = nextRange(vpA, posA), [insideB, toB] = nextRange(vpB, posB)
      let newB = Math.min(nextB, posB + (toA - posA), toB), newA = posA + (newB - posB)
      if (!insideA || !insideB) new ChangedRange(posA, newA, posB, newB).addToSet(found)
      posA = newA; posB = newB
    }

    if (!change) return found
    change.addToSet(found)
    posA = change.toA; posB = change.toB
  }
}
