import {ContentView} from "./contentview"
import {DocView} from "./docview"
import {InlineView, TextView, CompositionView} from "./inlineview"
import {clientRectsFor, Rect, domIndex} from "./dom"
import {LineDecoration, WidgetType, widgetsEq, BlockType} from "./decoration"
import {Attrs, combineAttrs, attrsEq, updateAttrs} from "./attributes"
import {Open} from "../../rangeset/src/rangeset"

export interface BlockView extends ContentView {
  merge(from: number, to: number, source: ContentView | null, takeDeco: boolean, composition: CompositionView | null): boolean
  match(other: BlockView): boolean
  split(at: number): BlockView
  type: BlockType
  dom: HTMLElement | null
}

export class LineView extends ContentView implements BlockView {
  children: InlineView[] = []
  length: number = 0
  dom!: HTMLElement | null
  prevAttrs: Attrs | null | undefined = undefined
  attrs: Attrs | null = null
  breakAfter = 0

  // Consumes source
  merge(from: number, to: number, source: BlockView | null, takeDeco: boolean, composition: CompositionView | null): boolean {
    if (source) {
      if (!(source instanceof LineView)) return false
      if (!this.dom) source.transferDOM(this) // Reuse source.dom when appropriate
    }
    if (takeDeco) this.setDeco(source ? source.attrs : null)

    let elts = source ? source.children : []
    let cur = this.childCursor()
    let {i: toI, off: toOff} = cur.findPos(to, 1)
    let {i: fromI, off: fromOff} = cur.findPos(from, -1)
    let dLen = from - to
    for (let view of elts) dLen += view.length
    this.length += dLen

    // Both from and to point into the same text view
    if (fromI == toI && fromOff) {
      let start = this.children[fromI]
      // Maybe just update that view and be done
      if (elts.length == 1 && start.merge(fromOff, toOff, elts[0])) return true
      if (elts.length == 0) { start.merge(fromOff, toOff, null); return true }
      // Otherwise split it, so that we don't have to worry about aliasing front/end afterwards
      let after = start.slice(toOff)
      if (!after.merge(0, 0, elts[elts.length - 1])) elts.push(after)
      toI++
      toOff = 0
    }

    // Make sure start and end positions fall on node boundaries
    // (fromOff/toOff are no longer used after this), and that if the
    // start or end of the elts can be merged with adjacent nodes,
    // this is done
    if (toOff) {
      let end = this.children[toI]
      if (elts.length && end.merge(0, toOff, elts[elts.length - 1])) elts.pop()
      else end.merge(0, toOff, null)
    } else if (toI < this.children.length && elts.length &&
               this.children[toI].merge(0, 0, elts[elts.length - 1])) {
      elts.pop()
    }
    if (fromOff) {
      let start = this.children[fromI]
      if (elts.length && start.merge(fromOff, undefined, elts[0])) elts.shift()
      else start.merge(fromOff, undefined, null)
      fromI++
    } else if (fromI && elts.length && this.children[fromI - 1].merge(this.children[fromI - 1].length, undefined, elts[0])) {
      elts.shift()
    }

    // Then try to merge any mergeable nodes at the start and end of
    // the changed range
    while (fromI < toI && elts.length && this.children[toI - 1].match(elts[elts.length - 1])) {
      elts.pop()
      toI--
    }
    while (fromI < toI && elts.length && this.children[fromI].match(elts[0])) {
      elts.shift()
      fromI++
    }

    if (composition && fromI < toI) {
      // If there's a zero-length composition on the edge of the update, don't overwrite it
      if (this.children[toI - 1] instanceof CompositionView && this.children[toI - 1].length == 0) toI--
      else if (this.children[fromI] instanceof CompositionView && this.children[fromI].length == 0) fromI++
    }

    // And if anything remains, splice the child array to insert the new elts
    if (elts.length || fromI != toI) this.replaceChildren(fromI, toI, elts)
    return true
  }

  split(at: number) {
    let end = new LineView
    end.breakAfter = this.breakAfter
    if (this.length == 0) return end
    let {i, off} = this.childCursor().findPos(at)
    if (off) {
      end.append(this.children[i].slice(off))
      this.children[i].merge(off, undefined, null)
      i++
    }
    for (let j = i; j < this.children.length; j++) end.append(this.children[j])
    this.children.length = i
    this.markDirty()
    this.length = at
    return end
  }

  transferDOM(other: LineView) {
    if (!this.dom) return
    other.setDOM(this.dom)
    other.prevAttrs = this.prevAttrs === undefined ? this.attrs : this.prevAttrs
    this.prevAttrs = undefined
    this.dom = null
  }

  setDeco(attrs: Attrs | null) {
    if (!attrsEq(this.attrs, attrs)) {
      if (this.dom) {
        this.prevAttrs = this.attrs
        this.markDirty()
      }
      this.attrs = attrs
    }
  }

  // Only called when building a line view in ContentBuilder
  append(child: InlineView) {
    this.children.push(child)
    child.setParent(this)
    this.length += child.length
  }

  // Only called when building a line view in ContentBuilder
  addLineDeco(deco: LineDecoration) {
    let attrs = deco.spec.attributes
    if (attrs) this.attrs = combineAttrs(attrs, this.attrs || {})
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = this.childCursor().findPos(pos)
    if (off) {
      let textDOM: Node | null = (this.children[i] as any).textDOM
      if (textDOM) return {node: textDOM, offset: off}
    }
    for (; i > 0; i--) {
      let prev = this.children[i - 1]
      if ((prev.length > 0 || prev.getSide() <= 0) && prev.dom!.parentNode == this.dom) break
    }
    return {node: this.dom!, offset: i ? domIndex(this.children[i - 1].dom!) + 1 : 0}
  }

  
  // FIXME might need another hack to work around Firefox's behavior
  // of not actually displaying the cursor even though it's there in
  // the DOM
  sync() {
    if (!this.dom) {
      this.setDOM(document.createElement("div"))
      this.dom!.className = "codemirror-line"
      this.prevAttrs = this.attrs ? null : undefined
    }
    if (this.prevAttrs !== undefined) {
      updateAttrs(this.dom!, this.prevAttrs, this.attrs)
      this.dom!.classList.add("codemirror-line")
      this.prevAttrs = undefined
    }
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
      if (!(child instanceof TextView)) return null
      let rects = clientRectsFor(child.dom!)
      if (rects.length != 1) return null
      totalWidth += rects[0].width
    }
    return {lineHeight: this.dom!.getBoundingClientRect().height,
            charWidth: totalWidth / this.length}
  }

  coordsAt(pos: number): Rect | null {
    for (let off = 0, i = 0; i < this.children.length; i++) {
      let child = this.children[i], end = off + child.length
      if (end >= pos) return child.coordsAt(pos - off)
      off = end
    }
    return (this.dom!.lastChild as HTMLElement).getBoundingClientRect()
  }

  createCompositionViewAround(textNode: Node): CompositionView {
    let dom = textNode
    while (dom.parentNode != this.dom) dom = dom.parentNode!
    let prev = dom.previousSibling, index = 0
    while (prev) {
      let found = this.children.indexOf(prev.cmView as any)
      if (found > -1) { index = found + 1; break }
      prev = prev.previousSibling
    }
    let view = new CompositionView(dom, textNode, 0)
    this.replaceChildren(index, index, [view])
    return view
  }

  match(other: ContentView) { return false }

  get type() { return BlockType.text }
}

const none = [] as any

export class BlockWidgetView extends ContentView implements BlockView {
  dom!: HTMLElement | null
  parent!: DocView | null
  breakAfter = 0

  constructor(
    public widget: WidgetType | null,
    public length: number,
    public type: BlockType,
    // This is set by the builder and used to distinguish between
    // adjacent widgets and parts of the same widget when calling
    // `merge`. It's kind of silly that it's an instance variable, but
    // it's hard to route there otherwise.
    public open: number = 0) {
    super()
  }

  merge(from: number, to: number, source: ContentView | null): boolean {
    if (!(source instanceof BlockWidgetView) || !source.open ||
        from > 0 && !(source.open & Open.start) ||
        to < this.length && !(source.open & Open.end)) return false
    if (!widgetsEq(this.widget, source.widget))
      throw new Error("Trying to merge an open widget with an incompatible node")
    this.length = from + source.length + (this.length - to)
    return true
  }

  split(at: number) {
    let len = this.length - at
    this.length = at
    return new BlockWidgetView(this.widget, len, this.type)
  }

  get children() { return none }

  sync() {
    if (!this.dom || !(this.widget && this.widget.updateDOM(this.dom))) {
      this.setDOM(this.widget ? this.widget.toDOM() : document.createElement("div"))
      this.dom!.contentEditable = "false"
    }
  }

  get overrideDOMText() {
    return this.parent ? this.parent!.state.doc.sliceLines(this.posAtStart, this.posAtEnd) : [""]
  }

  domBoundsAround() { return null }

  match(other: ContentView) {
    if (other instanceof BlockWidgetView && other.type == this.type &&
        (other.widget && other.widget.constructor) == (this.widget && this.widget.constructor)) {
      if (this.widget && !other.widget!.eq(this.widget.value)) this.markDirty(true)
      this.widget = other.widget
      this.length = other.length
      this.breakAfter = other.breakAfter
      return true
    }
    return false
  }
}
