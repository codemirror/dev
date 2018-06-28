import {Text, TextCursor} from "../../doc/src/text"
import {changedRanges, ChangedRange} from "../../doc/src/diff"
import {EditorState, Plugin, Selection} from "../../state/src/state"
import {DecorationSet, joinRanges, attrsEq, WidgetType, RangeDesc, buildLineElements} from "./decoration"
import {Viewport, ViewportState} from "./viewport"
import {DOMObserver} from "./domobserver"
import {getRoot, clientRectsFor} from "./dom"
import {HeightMap, HeightOracle} from "./heightmap"

declare global {
  interface Node { cmView: ViewDesc | undefined; cmIgnore: boolean | undefined }
}

type A<T> = ReadonlyArray<T>

const enum dirty { not = 0, child = 1, node = 2 }

export abstract class ViewDesc {
  constructor(public parent: ViewDesc | null, public dom: Node | null) {
    if (dom) dom.cmView = this
  }

  abstract length: number;
  abstract children: ViewDesc[];
  dirty: number = dirty.not;

  get childGap() { return 0 }
  get overrideDOMText(): string | null { return null }

  get posAtStart(): number {
    return this.parent ? this.parent.posBefore(this) : 0
  }

  get posAtEnd(): number {
    return this.posAtStart + this.length
  }

  posBefore(desc: ViewDesc): number {
    let pos = this.posAtStart
    for (let child of this.children) {
      if (child == desc) return pos
      pos += child.length + this.childGap
    }
    throw new RangeError("Invalid child in posBefore")
  }

  posAfter(desc: ViewDesc): number {
    return this.posBefore(desc) + desc.length
  }

  syncDOMChildren() {
    if (!this.dom) return
    let dom = this.dom.firstChild
    for (let desc of this.children) {
      let childDOM = desc.dom
      if (!childDOM) continue
      if (childDOM.parentNode == this.dom) {
        while (childDOM != dom) dom = rm(dom!)
        dom = dom.nextSibling
      } else {
        this.dom.insertBefore(childDOM, dom)
      }
    }
    while (dom) dom = rm(dom)
  }

  sync() {
    if (this.dirty & dirty.node)
      this.syncDOMChildren()
    if (this.dirty & dirty.child)
      for (let child of this.children) if (child.dirty) child.sync()
    this.dirty = dirty.not
  }

  domFromPos(pos: number): {node: Node, offset: number} | null { return null }

  localPosFromDOM(node: Node, offset: number): number {
    let after: Node | null
    if (node == this.dom) {
      after = this.dom.childNodes[offset]
    } else {
      let bias = !node.firstChild ? 0 : offset == 0 ? -1 : 1
      for (;;) {
        let parent = node.parentNode!
        if (parent == this.dom) break
        if (bias == 0 && parent.firstChild != parent.lastChild) {
          if (node == parent.firstChild) bias = -1
          else bias = 1
        }
        node = parent
      }
      if (bias < 0) after = node
      else after = node.nextSibling
    }
    while (after && !after.cmView) after = after.nextSibling
    if (!after) return this.length

    for (let i = 0, pos = 0;; i++) {
      let child = this.children[i]
      if (child.dom == after) return pos
      pos += child.length + this.childGap
    }
  }

  // FIXME track precise dirty ranges, to avoid full DOM sync on every touched node?
  markDirty() {
    if (this.dirty & dirty.node) return
    this.dirty |= dirty.node
    for (let parent = this.parent; parent; parent = parent.parent) {
      if (parent.dirty & dirty.child) return
      parent.dirty |= dirty.child
    }
  }
}

// Remove a DOM node and return its next sibling.
function rm(dom: Node): Node {
  let next = dom.nextSibling
  dom.parentNode!.removeChild(dom)
  return next!
}

export class DocViewDesc extends ViewDesc {
  children: ViewDesc[] = [new LineViewDesc(this, [])]
  visiblePart: Viewport = Viewport.empty
  viewports: Viewport[] = []

  text: Text = Text.create("")
  decorations: PluginDeco[] = []
  selection: Selection = Selection.default

  observer: DOMObserver

  viewportState: ViewportState
  heightMap: HeightMap = HeightMap.empty()
  heightOracle: HeightOracle = new HeightOracle
  layoutCheckScheduled: number = -1

  get length() { return this.text.length }
  
  get childGap() { return 1 }

  constructor(dom: HTMLElement,
              onDOMChange: (from: number, to: number) => void,
              onSelectionChange: () => void) {
    super(null, dom)
    this.dirty = dirty.node

    this.viewportState = new ViewportState
    this.observer = new DOMObserver(this, onDOMChange, onSelectionChange, () => this.checkLayout())
  }

  // FIXME need some way to stabilize viewport—if a change causes the
  // top of the visible viewport to move, scroll position should be
  // adjusted to keep the content in place
  update(state: EditorState) {
    let decorations = getDecorations(state)

    if (this.dirty == dirty.not && this.text.eq(state.doc) && sameDecorations(decorations, this.decorations)) {
      if (state.selection.eq(this.selection)) return
      if (state.selection.primary.from >= this.visiblePart.from &&
          state.selection.primary.to <= this.visiblePart.to) {
        this.selection = state.selection
        this.observer.withoutListening(() => this.updateSelection()) // FIXME suppressing selection events doesn't work yet
        return
      }
    }

    let changes = fullChangedRanges(changedRanges(this.text, state.doc), decorations, this.decorations)
    let oldLength = this.text.length
    this.text = state.doc
    this.decorations = decorations
    this.selection = state.selection
    this.heightMap = this.heightMap
      .applyChanges(state.doc, decorations.map(d => d.decorations), changes.height)
      .updateHeight(this.heightOracle.setDoc(state.doc))

    this.updateInner(changes.content, oldLength)

    if (this.layoutCheckScheduled < 0)
      this.layoutCheckScheduled = requestAnimationFrame(() => this.checkLayout())
  }

  private updateInner(changes: A<ChangedRange> = [], oldLength: number = this.text.length) {
    let visible = this.visiblePart = this.viewportState.getViewport(this.text, this.heightMap)
    let viewports: Viewport[] = [visible]
    let {head, anchor} = this.selection.primary
    if (head < visible.from || head > visible.to)
      viewports.push(this.heightMap.lineViewport(head, this.text))
    if (!viewports.some(({from, to}) => anchor >= from && anchor <= to))
      viewports.push(this.heightMap.lineViewport(anchor, this.text))
    viewports.sort((a, b) => a.from - b.from)
    let matchingRanges = findMatchingRanges(viewports, this.viewports, changes)

    let decoSets = this.decorations.map(d => d.decorations)
    let gaps: HTMLElement[] = [], newGaps = false

    let childI = this.children.length
    let posA = oldLength, posB = this.text.length
    for (let i = viewports.length - 1;; i--) {
      let nextA = i < 0 ? -1 : matchingRanges[i].to
      let nextB = i < 0 ? 0 : viewports[i].to + 1
      let gap: GapViewDesc | null = null, endI = childI
      while (posA > nextA) {
        let nextChild = this.children[--childI]
        posA -= nextChild.length + 1
        if (nextChild instanceof GapViewDesc) gap = nextChild
      }
      if (posB > nextB) {
        if (!gap || endI - childI != 1) {
          if (!gap) { gap = new GapViewDesc(this); newGaps = true }
          this.children.splice(childI, endI - childI, gap)
          this.markDirty()
        }
        gap.update(posB - nextB, this.heightMap.heightAt(posB, 1) - this.heightMap.heightAt(nextB, -1))
        gaps.push(gap.dom! as HTMLElement)
      } else if (endI != childI) {
        this.children.splice(childI, endI - childI)
        this.markDirty()
      }

      if (i < 0) break

      let viewport = viewports[i], matching = matchingRanges[i]
      endI = childI
      if (matching.from == matching.to) {
        this.children.splice(childI, endI - childI, new LineViewDesc(this, []))
        endI = childI + 1
      } else {
        while (posA >= matching.from) posA -= this.children[--childI].length + 1
      }
      this.updatePart(childI, endI, matching, viewport, changes, decoSets)
      posB = viewport.from - 1
    }

    if (newGaps) this.observer.observeIntersection(gaps)
    this.viewports = viewports
    this.observer.withoutListening(() => {
      this.sync()
      this.updateSelection()
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
      this.updatePartRange(fromI, fromOff, toI, toOff, LineElementBuilder.build(this.text, fromB, toB, decoSets))
    }
  }

  private updatePartRange(fromI: number, fromOff: number, toI: number, toOff: number, lines: LineElementViewDesc[][]) {
    // All children in the touched range should be line views
    let children = this.children as LineViewDesc[]
    if (lines.length == 1) {
      if (fromI == toI) { // Change within single line
        children[fromI].update(fromOff, toOff, lines[0])
      } else { // Join lines
        let tail = children[toI].detachTail(toOff)
        children[fromI].update(fromOff, undefined, appendLineElements(lines[0], tail))
        children.splice(fromI + 1, toI - fromI)
        this.markDirty()
      }
    } else { // Across lines
      let tail = children[toI].detachTail(toOff)
      children[fromI].update(fromOff, undefined, lines[0])
      let insert = []
      for (let j = 1; j < lines.length; j++)
        insert.push(new LineViewDesc(this, j < lines.length - 1 ? lines[j] : appendLineElements(lines[j], tail)))
      children.splice(fromI + 1, toI - fromI, ...insert)
      this.markDirty()
    }
  }

  updateSelection(takeFocus: boolean = false) {
    let root = getRoot(this.dom as HTMLElement)
    if (!takeFocus && root.activeElement != this.dom) return

    let anchor = this.domFromPos(this.selection.primary.anchor)!
    let head = this.domFromPos(this.selection.primary.head)!
    // FIXME check for equivalent positions, don't update if both are equiv

    let domSel = root.getSelection(), range = document.createRange()
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

  registerIntersection() {
    let gapDOM: HTMLElement[] = []
    for (let child of this.children) if (child instanceof GapViewDesc) gapDOM.push(child.dom as HTMLElement)
    this.observer.observeIntersection(gapDOM)
  }

  checkLayout() {
    cancelAnimationFrame(this.layoutCheckScheduled)
    this.layoutCheckScheduled = -1

    this.viewportState.updateFromDOM(this.dom as HTMLElement)
    if (this.viewportState.top == this.viewportState.bottom) return // We're invisible!
    let lineHeights: number[] | null = this.measureVisibleLineHeights(), refresh = false
    if (this.heightOracle.maybeRefresh(lineHeights)) {
      let {lineHeight, charWidth} = this.measureTextSize()
      refresh = this.heightOracle.refresh(getComputedStyle(this.dom as HTMLElement).whiteSpace!,
                                          lineHeight, (this.dom as HTMLElement).clientWidth / charWidth)
    }

    // FIXME should maybe also check gap sizes? i.e. if new
    // measurements mean a gap that's currently 200px should now be
    // 300px that should be noticed
    for (let i = 0;; i++) {
      this.heightMap = this.heightMap.updateHeight(this.heightOracle, 0, refresh,
                                                   this.visiblePart.from, this.visiblePart.to,
                                                   lineHeights || this.measureVisibleLineHeights())
      if (this.viewportState.coveredBy(this.text, this.visiblePart, this.heightMap)) break
      if (i > 10) throw new Error("Layout failed to converge")
      this.updateInner()
      lineHeights = null
      refresh = false
      this.viewportState.updateFromDOM(this.dom as HTMLElement)
    }
  }

  nearest(dom: Node): ViewDesc | null {
    for (let cur: Node | null = dom; cur;) {
      let domView = cur.cmView
      if (domView) {
        for (let v: ViewDesc | null = domView; v; v = v.parent)
          if (v == this) return domView
      }
      cur = cur.parentNode
    }
    return null
  }

  readDOMRange(from: number, to: number): {from: number, to: number, text: string} {
    // FIXME partially parse lines when possible
    let fromI = -1, fromStart = -1, toI = -1, toEnd = -1
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      /*      if (pos < from && end > to) {
        let result = child.parseRange(from - pos, to - pos)
        return {from: result.from + pos, to: result.to + pos, text: result.text}
      }*/
      if (end >= from && fromI == -1) { fromI = i; fromStart = pos }
      if (end >= to && toI == -1) { toI = i; toEnd = end; break }
      pos = end + 1
    }
    let startDOM = (fromI ? this.children[fromI - 1].dom!.nextSibling : null) || this.dom!.firstChild
    let endDOM = toI < this.children.length - 1 ? this.children[toI + 1].dom : null
    return {from: fromStart, to: toEnd, text: readDOM(startDOM, endDOM)}
  }

  posFromDOM(node: Node, offset: number): number {
    let desc = this.nearest(node)
    if (!desc) throw new RangeError("Trying to find position for a DOM position outside of the document")
    return desc.localPosFromDOM(node, offset) + desc.posAtStart
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
      if (child instanceof LineViewDesc) {
        let measure = child.measureTextSize()
        if (measure) return measure
      }
    }
    // If no workable line exists, force a layout of a measurable element
    let dummy = document.createElement("div")
    dummy.textContent = "abc def ghi jkl mno pqr stu"
    this.dom!.appendChild(dummy)
    let rect = clientRectsFor(dummy.firstChild!)[0]
    let result = {lineHeight: dummy.getBoundingClientRect().height,
                  charWidth: rect ? rect.width / 27 : 7}
    dummy.remove()
    return result
  }

  destroy() {
    cancelAnimationFrame(this.layoutCheckScheduled)
    this.observer.destroy()
  }
}

class GapViewDesc extends ViewDesc {
  length: number = 0

  constructor(parent: ViewDesc) {
    super(parent, document.createElement("div"))
    ;(this.dom as HTMLElement).contentEditable = "false"
  }

  get children() { return noChildren }

  update(length: number, height: number) {
    this.length = length
    ;(this.dom as HTMLElement).style.height = height + "px"
  }

  get overrideDOMText() {
    return this.parent ? (this.parent as DocViewDesc).text.slice(this.posAtStart, this.posAtEnd) : ""
  }
}

const MAX_JOIN_LEN = 256

class LineViewDesc extends ViewDesc {
  children: LineElementViewDesc[];
  length: number;

  constructor(parent: DocViewDesc, content: LineElementViewDesc[]) {
    super(parent, document.createElement("div"))
    this.length = 0
    this.children = []
    if (content.length) this.update(0, 0, content)
    this.markDirty()
  }

  update(from: number, to: number = this.length, content: LineElementViewDesc[]) {
    this.markDirty()
    let cur = new ChildCursor(this.children, this.length)
    let {i: toI, off: toOff} = cur.findPos(to, 1)
    let {i: fromI, off: fromOff} = cur.findPos(from, -1)
    let dLen = from - to
    for (let desc of content) dLen += desc.length
    this.length += dLen

    // Both from and to point into the same text view
    if (fromI == toI && fromOff) {
      let start = this.children[fromI] as TextViewDesc
      // Maybe just update that view and be done
      if (content.length == 1 && start.merge(content[0], fromOff, toOff)) return
      if (content.length == 0) return start.cut(fromOff, toOff)
      // Otherwise split it, so that we don't have to worry about aliasting front/end afterwards
      appendLineElements(content, [new TextViewDesc(start.text.slice(toOff), start.tagName, start.class, start.attrs)])
      toI++
      toOff = 0
    }

    // Make sure start and end positions fall on node boundaries
    // (fromOff/toOff are no longer used after this), and that if the
    // start or end of the content can be merged with adjacent nodes,
    // this is done
    if (toOff) {
      let end = this.children[toI] as TextViewDesc
      if (content.length && end.merge(content[content.length - 1], 0, toOff)) content.pop()
      else end.cut(0, toOff)
    } else if (toI < this.children.length && content.length &&
               this.children[toI].merge(content[content.length - 1], 0, 0)) {
      content.pop()
    }
    if (fromOff) {
      let start = this.children[fromI] as TextViewDesc
      if (content.length && start.merge(content[0], fromOff)) content.shift()
      else start.cut(fromOff)
      fromI++
    } else if (fromI && content.length && this.children[fromI - 1].merge(content[0], this.children[fromI - 1].length)) {
      content.shift()
    }

    // Then try to merge any mergeable nodes at the start and end of
    // the changed range
    while (fromI < toI && content.length && this.children[toI - 1].merge(content[content.length - 1])) {
      content.pop()
      toI--
    }
    while (fromI < toI && content.length && this.children[fromI].merge(content[0])) {
      content.shift()
      fromI++
    }

    // And if anything remains, splice the child array to insert the new content
    if (content.length || fromI != toI) {
      for (let desc of content) desc.finish(this)
      this.children.splice(fromI, toI - fromI, ...content)
    }
  }

  detachTail(from: number): TextViewDesc[] {
    let result: TextViewDesc[] = []
    if (this.length == 0) return result
    let {i, off} = new ChildCursor(this.children, this.length).findPos(from)
    if (off > 0) {
      let child = this.children[i] as TextViewDesc
      result.push(new TextViewDesc(child.text.slice(off), child.tagName, child.class, child.attrs))
      child.cut(off)
      i++
    }
    if (i < this.children.length) {
      for (let j = i; j < this.children.length; j++) result.push(this.children[j] as TextViewDesc)
      this.children.length = i
      this.markDirty()
    }
    this.length = from
    return result
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = new ChildCursor(this.children, this.length).findPos(pos)
    while (off == 0 && i > 0 && this.children[i - 1].getSide() > 0) i--
    if (off == 0) return {node: this.dom!, offset: i}
    let child = this.children[i]
    if (child instanceof TextViewDesc) return {node: child.textDOM!, offset: off}
    else return {node: this.dom!, offset: i}
  }

  // FIXME might need another hack to work around Firefox's behavior
  // of not actually displaying the cursor even though it's there in
  // the DOM
  sync() {
    super.sync()
    let last = this.dom!.lastChild
    if (!last || last.nodeName == "BR") {
      let hack = document.createElement("BR")
      hack.cmIgnore = true
      this.dom!.appendChild(hack)
    }
  }

  measureTextSize(): {lineHeight: number, charWidth: number} | null {
    if (this.children.length == 0 || this.length > 20) return null
    let totalWidth = 0
    for (let child of this.children) {
      if (!(child instanceof TextViewDesc)) return null
      let rects = clientRectsFor(child.dom!)
      if (rects.length != 1) return null
      totalWidth += rects[0].width
    }
    return {lineHeight: (this.dom as HTMLElement).getBoundingClientRect().height,
            charWidth: totalWidth / this.length}
  }
}

const noChildren: ViewDesc[] = []

abstract class LineElementViewDesc extends ViewDesc {
  merge(other: LineElementViewDesc, from: number = 0, to: number = 0): boolean { return false }
  get children() { return noChildren }
  finish(parent: ViewDesc) {}
  getSide() { return 0 }
}

function appendLineElements(a: LineElementViewDesc[], b: LineElementViewDesc[]): LineElementViewDesc[] {
  let i = 0
  if (b.length && a.length) {
    let last = a[a.length - 1]
    if (last.merge(b[0], last.length)) i++
  }
  for (; i < b.length; i++) a.push(b[i])
  return a
}

class TextViewDesc extends LineElementViewDesc {
  textDOM: Node | null = null;
  class: string | null;

  constructor(public text: string,
              public tagName: string | null,
              public clss: string | null,
              public attrs: {[key: string]: string} | null) {
    super(null, null)
    this.class = clss
  }

  finish(parent: ViewDesc) {
    this.parent = parent
    if (this.dom) return
    this.textDOM = document.createTextNode(this.text)
    let tagName = this.tagName || (this.attrs || this.class ? "span" : null)
    if (tagName) {
      this.dom = document.createElement(tagName)
      this.dom.appendChild(this.textDOM)
      if (this.class) (this.dom as HTMLElement).className = this.class
      if (this.attrs) for (let name in this.attrs) (this.dom as HTMLElement).setAttribute(name, this.attrs[name])
    } else {
      this.dom = this.textDOM
    }
    this.markDirty()
    this.dom.cmView = this
  }

  get length() { return this.text.length }

  sync() {
    if (this.dirty & dirty.node) {
      if (this.textDOM!.nodeValue != this.text) this.textDOM!.nodeValue = this.text
      let dom = this.dom!
      if (this.textDOM != dom && (this.dom!.firstChild != this.textDOM || dom.lastChild != this.textDOM)) {
        while (dom.firstChild) dom.removeChild(dom.firstChild)
        dom.appendChild(this.textDOM!)
      }
    }
    this.dirty = dirty.not
  }

  merge(other: LineElementViewDesc, from: number = 0, to: number = this.length): boolean {
    if (!(other instanceof TextViewDesc) ||
        other.tagName != this.tagName || other.class != this.class ||
        !attrsEq(other.attrs, this.attrs) || this.length - (to - from) + other.length > MAX_JOIN_LEN)
      return false
    this.text = this.text.slice(0, from) + other.text + this.text.slice(to)
    this.markDirty()
    return true
  }

  cut(from: number, to: number = this.length) {
    this.text = this.text.slice(0, from) + this.text.slice(to)
    this.markDirty()
  }

  localPosFromDOM(node: Node, offset: number): number {
    return node == this.textDOM ? offset : offset ? this.text.length : 0
  }

  domFromPos(pos: number) { return {node: this.textDOM!, offset: pos} }
}

class WidgetViewDesc extends LineElementViewDesc {
  constructor(readonly widget: WidgetType<any>, readonly side: number) {
    super(null, null)
  }

  finish(parent: ViewDesc) {
    this.parent = parent
    if (!this.dom) {
      this.dom = this.widget.toDOM()
      ;(this.dom as HTMLElement).contentEditable = "false"
      this.dom.cmView = this
    }
    this.markDirty()
  }

  sync() { this.dirty = dirty.not }

  get length() { return 0 }
  getSide() { return this.side }
  get overrideDOMText() { return "" }

  merge(other: LineElementViewDesc): boolean {
    return other instanceof WidgetViewDesc && other.widget.compare(this.widget) && other.side == this.side
  }
}

class CollapsedViewDesc extends LineElementViewDesc {
  constructor(public length: number) {
    super(null, null)
  }
  finish(parent: ViewDesc) { this.parent = parent }
  merge(other: LineElementViewDesc, from: number = 0, to: number = this.length): boolean {
    if (!(other instanceof CollapsedViewDesc)) return false
    this.length = from + other.length + (this.length - to)
    return true
  }
}

export class LineElementBuilder {
  elements: LineElementViewDesc[][] = [[]];
  active: RangeDesc[] = [];
  cursor: TextCursor;
  text: string;
  textOff: number = 0;

  constructor(text: Text, public pos: number) {
    this.cursor = text.iter()
    this.text = this.cursor.next(pos)
  }

  buildText(length: number, tagName: string | null, clss: string | null, attrs: {[key: string]: string} | null) {
    while (length > 0) {
      if (this.textOff == this.text.length) {
        this.text = this.cursor.next()
        this.textOff = 0
      }

      let end = Math.min(this.textOff + length, this.text.length)
      for (let i = this.textOff; i < end; i++) {
        if (this.text.charCodeAt(i) == 10) { end = i; break }
      }
      if (end > this.textOff) {
        this.elements[this.elements.length - 1].push(
          new TextViewDesc(this.text.slice(this.textOff, end), tagName, clss, attrs))
        length -= end - this.textOff
        this.textOff = end
      }
      if (end < this.text.length && length) {
        this.elements.push([])
        length--
        this.textOff++
      }
    }
  }

  advance(pos: number) {
    if (pos <= this.pos) return

    let tagName = null, clss = null
    let attrs: {[key: string]: string} | null = null
    for (let desc of this.active) {
      let spec = desc.spec
      if (spec.tagName) tagName = spec.tagName
      if (spec.class) clss = clss ? clss + " " + spec.class : spec.class
      if (spec.attributes) for (let name in spec.attributes) {
        let value = spec.attributes[name]
        if (value == null) continue
        if (name == "class") {
          clss = clss ? clss + " " + value : value
        } else {
          if (!attrs) attrs = {}
          if (name == "style" && attrs.style) value = attrs.style + ";" + value
          attrs[name] = value
        }
      }
    }
    this.buildText(pos - this.pos, tagName, clss, attrs)
    this.pos = pos
  }

  advanceCollapsed(pos: number) {
    if (pos > this.pos) {
      let line = this.elements[this.elements.length - 1]
      if (line.length && (line[line.length - 1] instanceof CollapsedViewDesc))
        line[line.length - 1].length += (pos - this.pos)
      else
        line.push(new CollapsedViewDesc(pos - this.pos))

      // Advance the iterator past the collapsed content
      let length = pos - this.pos
      if (this.textOff + length <= this.text.length) {
        this.textOff += length
      } else {
        this.text = this.cursor.next(length - (this.text.length - this.textOff))
        this.textOff = 0
      }

      this.pos = pos
    }
  }

  addWidget(widget: WidgetType<any>, side: number) {
    this.elements[this.elements.length - 1].push(new WidgetViewDesc(widget, side))
  }

  static build(text: Text, from: number, to: number, decorations: A<DecorationSet>): LineElementViewDesc[][] {
    let builder = new LineElementBuilder(text, from)
    buildLineElements(decorations, from, to, builder)
    return builder.elements
  }
}

function readDOM(start: Node | null, end: Node | null): string {
  let text = "", cur = start
  if (cur) for (;;) {
    text += readDOMNode(cur!)
    let next: Node | null = cur!.nextSibling
    if (next == end) break
    if (isBlockNode(cur!)) text += "\n"
    cur = next
  }
  return text
}

function readDOMNode(node: Node): string {
  // FIXME add a way to ignore certain nodes based on their desc
  if (node.cmIgnore) return ""
  let desc = node.cmView
  let fromDesc = desc && desc.overrideDOMText
  if (fromDesc != null) return fromDesc
  if (node.nodeType == 3) return node.nodeValue as string
  if (node.nodeName == "BR") return node.nextSibling ? "\n" : ""
  if (node.nodeType == 1) return readDOM(node.firstChild, null)
  return ""
}

function isBlockNode(node: Node): boolean {
  return node.nodeType == 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|DD|DT|H\d|SECTION|PRE)$/.test(node.nodeName)
}

class ChildCursor {
  off: number = 0

  constructor(public children: ViewDesc[], public pos: number,
              public gap: number = 0, public i: number = children.length) {
    this.pos += gap
  }

  findPos(pos: number, bias: number = 1): this {
    for (;;) {
      if (pos > this.pos || pos == this.pos && (bias > 0 || this.i == 0)) {
        this.off = pos - this.pos
        return this
      }
      this.pos -= this.children[--this.i].length + this.gap
    }
  }
}

function findPluginDeco(decorations: A<PluginDeco>, plugin: Plugin | null): DecorationSet | null {
  for (let deco of decorations)
    if (deco.plugin == plugin) return deco.decorations
  return null
}

function fullChangedRanges(diff: A<ChangedRange>,
                           decorations: A<PluginDeco>,
                           oldDecorations: A<PluginDeco>
                          ): {content: A<ChangedRange>, height: A<ChangedRange>} {
  let contentRanges: number[] = [], heightRanges: number[] = []
  for (let deco of decorations) {
    let newRanges = (findPluginDeco(oldDecorations, deco.plugin) || DecorationSet.empty)
      .changedRanges(deco.decorations, diff)
    contentRanges = joinRanges(contentRanges, newRanges.content)
    heightRanges = joinRanges(heightRanges, newRanges.height)
  }
  for (let old of oldDecorations) {
    if (!findPluginDeco(decorations, old.plugin)) {
      let newRanges = old.decorations.changedRanges(DecorationSet.empty, diff)
      contentRanges = joinRanges(contentRanges, newRanges.content)
      heightRanges = joinRanges(heightRanges, newRanges.height)
    }
  }
  return {content: extendWithRanges(diff, contentRanges),
          height: extendWithRanges(diff, heightRanges)}
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
      let from = ranges[rI++], to = ranges[rI++]
      addChangedRange(result, from + off, to + off, from, to)
    }
    if (!next) return result
    addChangedRange(result, next.fromA, next.toA, next.fromB, next.toB)
    posA = next.toA; posB = next.toB
  }
}

type PluginDeco = {plugin: Plugin | null, decorations: DecorationSet}

function sameDecorations(a: PluginDeco[], b: PluginDeco[]) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].decorations != b[i].decorations) return false
  return true
}

function getDecorations(state: EditorState): PluginDeco[] {
  let result: PluginDeco[] = [], plugins = state.plugins
  for (let plugin of plugins) {
    let prop = plugin.props.decorations
    if (!prop) continue
    let decorations = prop(state)
    if (decorations.size) result.push({plugin, decorations})
  }
  return result
}

function boundAfter(viewport: Viewport, pos: number): number {
  return pos < viewport.from ? viewport.from : pos < viewport.to ? viewport.to : 2e9
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
      let boundA = boundAfter(viewportA, posA), boundB = boundAfter(viewportB, posB)
      if (boundA >= nextA && boundB >= nextB) break
      let advance = Math.min(Math.min(boundA, nextA) - posA, Math.min(boundB, nextB) - posB)
      let endA = posA + advance, endB = posB + advance
      if ((posA >= viewportA.to || endA <= viewportA.from) != (posB >= viewportB.to || endB <= viewportB.from))
        addChangedRange(result, viewportA.clip(posA), viewportA.clip(endA), viewportB.clip(posB), viewportB.clip(endB))
      posA = endA; posB = endB
    }

    if (!range || (range.fromA > viewportA.to && range.fromB > viewportB.to)) break

    // Clip existing ranges to the viewports
    if ((range.toA >= viewportA.from && range.fromA <= viewportA.to) ||
        (range.toB >= viewportB.from && range.fromB <= viewportB.to))
      addChangedRange(result, Math.max(range.fromA, viewportA.from), Math.min(range.toA, viewportA.to),
                      Math.max(range.fromB, viewportB.from), Math.min(range.toB, viewportB.to))

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
