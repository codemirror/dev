import {ContentView, dirty} from "./contentview"
import {WidgetType, attrsEq, DecorationSet, Decoration, RangeDecoration, PointDecoration} from "./decoration"
import {Text, TextCursor} from "../../doc/src/text"
import {RangeIterator, RangeSet} from "../../rangeset/src/rangeset"

const noChildren: ContentView[] = []

export abstract class InlineView extends ContentView {
  merge(other: InlineView, from: number = 0, to: number = 0): boolean { return false }
  get children() { return noChildren }
  finish(parent: ContentView) {}
  getSide() { return 0 }

  static appendInline(a: InlineView[], b: InlineView[]): InlineView[] {
    let i = 0
    if (b.length && a.length) {
      let last = a[a.length - 1]
      if (last.merge(b[0], last.length)) i++
    }
    for (; i < b.length; i++) a.push(b[i])
    return a
  }
}

const MAX_JOIN_LEN = 256

export class TextView extends InlineView {
  textDOM: Node | null = null;
  class: string | null;

  constructor(public text: string,
              public tagName: string | null,
              public clss: string | null,
              public attrs: {[key: string]: string} | null) {
    super(null, null)
    this.class = clss
  }

  finish(parent: ContentView) {
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

  merge(other: InlineView, from: number = 0, to: number = this.length): boolean {
    if (!(other instanceof TextView) ||
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

  domBoundsAround(from: number, to: number, offset: number) {
    return {from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom!.nextSibling}
  }

  coordsAt(pos: number): ClientRect {
    let range = document.createRange()
    range.setEnd(this.textDOM!, pos)
    range.setStart(this.textDOM!, pos)
    return range.getBoundingClientRect()
  }
}

export class WidgetView extends InlineView {
  dom!: HTMLElement | null

  constructor(readonly widget: WidgetType<any>, readonly side: number) {
    super(null, null)
  }

  finish(parent: ContentView) {
    this.parent = parent
    if (!this.dom) {
      this.dom = this.widget.toDOM()
      this.dom.contentEditable = "false"
      this.dom.cmView = this
    }
    this.markDirty()
  }

  sync() { this.dirty = dirty.not }

  get length() { return 0 }
  getSide() { return this.side }
  get overrideDOMText() { return "" }

  merge(other: InlineView): boolean {
    return other instanceof WidgetView && other.widget.compare(this.widget) && other.side == this.side
  }

  ignoreMutation(): boolean { return true }
  ignoreEvent(): boolean { return true }
}

// FIXME these not being rendered means that reading the DOM around
// collapsed text will currently delete the text, since `DOMReader`
// won't see it
export class CollapsedView extends InlineView {
  constructor(public length: number) {
    super(null, null)
  }

  finish(parent: ContentView) { this.parent = parent }

  merge(other: InlineView, from: number = 0, to: number = this.length): boolean {
    if (!(other instanceof CollapsedView)) return false
    this.length = from + other.length + (this.length - to)
    return true
  }

  get overrideDOMText() {
    let top: ContentView = this
    while (top.parent) top = top.parent
    let text = (top as any).text, start = this.posAtStart
    return text ? text.slice(start, start + this.length) : ""
  }

  domBoundsAround() { return null }
}

export class InlineBuilder implements RangeIterator<Decoration> {
  elements: InlineView[][] = [[]];
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
          new TextView(this.text.slice(this.textOff, end), tagName, clss, attrs))
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

  advance(pos: number, active: Decoration[]) {
    if (pos <= this.pos) return

    let tagName = null, clss = null
    let attrs: {[key: string]: string} | null = null
    for (let deco of active as RangeDecoration[]) {
      if (deco.tagName) tagName = deco.tagName
      if (deco.class) clss = clss ? clss + " " + deco.class : deco.class
      if (deco.attributes) for (let name in deco.attributes) {
        let value = deco.attributes[name]
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
    if (pos <= this.pos) return

    let line = this.elements[this.elements.length - 1]
    if (line.length && (line[line.length - 1] instanceof CollapsedView))
      line[line.length - 1].length += (pos - this.pos)
    else
      line.push(new CollapsedView(pos - this.pos))

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

  point(deco: Decoration) {
    this.elements[this.elements.length - 1].push(new WidgetView(deco.widget!, deco instanceof PointDecoration ? deco.bias : 0))
  }

  ignoreRange(deco: Decoration): boolean { return !(deco as RangeDecoration).affectsSpans }
  ignorePoint(deco: Decoration): boolean { return !deco.widget }

  static build(text: Text, from: number, to: number, decorations: ReadonlyArray<DecorationSet>): InlineView[][] {
    let builder = new InlineBuilder(text, from)
    RangeSet.iterateSpans(decorations, from, to, builder)
    return builder.elements
  }
}
