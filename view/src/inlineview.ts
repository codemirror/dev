import {ContentView, DOMPos} from "./contentview"
import {WidgetType} from "./decoration"
import {attrsEq} from "./attributes"
import {Text} from "../../text"
import {Rect} from "./dom"
import browser from "./browser"
import {Open} from "./buildview"

const none: any[] = []

export abstract class InlineView extends ContentView {
  abstract merge(from: number, to?: number, source?: InlineView | null): boolean
  match(other: InlineView) { return false }
  get children() { return none }
  abstract slice(from: number, to?: number): InlineView
  getSide() { return 0 }
}

const MaxJoinLen = 256

export class TextView extends InlineView {
  textDOM: Node | null = null;
  class: string | null;

  constructor(public text: string,
              public tagName: string | null,
              clss: string | null,
              public attrs: {[key: string]: string} | null) {
    super()
    this.class = clss
  }

  get length() { return this.text.length }

  createDOM(textDOM?: Node) {
    let tagName = this.tagName || (this.attrs || this.class ? "span" : null)
    this.textDOM = textDOM || document.createTextNode(this.text)
    if (tagName) {
      let dom = document.createElement(tagName)
      dom.appendChild(this.textDOM)
      if (this.class) dom.className = this.class
      if (this.attrs) for (let name in this.attrs) dom.setAttribute(name, this.attrs[name])
      this.setDOM(dom)
    } else {
      this.setDOM(this.textDOM)
    }
  }

  sync() {
    if (!this.dom) this.createDOM()
    if (this.textDOM!.nodeValue != this.text) {
      this.textDOM!.nodeValue = this.text
      let dom = this.dom!
      if (this.textDOM != dom && (this.dom!.firstChild != this.textDOM || dom.lastChild != this.textDOM)) {
        while (dom.firstChild) dom.removeChild(dom.firstChild)
        dom.appendChild(this.textDOM!)
      }
    }
  }

  reuseDOM(dom: Node) {
    if (dom.nodeType != 3) return false
    this.createDOM(dom)
    return true
  }

  merge(from: number, to: number = this.length, source: InlineView | null = null): boolean {
    if (source &&
        (!(source instanceof TextView) ||
         source.tagName != this.tagName || source.class != this.class ||
         !attrsEq(source.attrs, this.attrs) || this.length - (to - from) + source.length > MaxJoinLen))
      return false
    this.text = this.text.slice(0, from) + (source ? source.text : "") + this.text.slice(to)
    this.markDirty()
    return true
  }

  slice(from: number, to: number = this.length) {
    return new TextView(this.text.slice(from, to), this.tagName, this.class, this.attrs)
  }

  localPosFromDOM(node: Node, offset: number): number {
    return node == this.textDOM ? offset : offset ? this.text.length : 0
  }

  domAtPos(pos: number) { return new DOMPos(this.textDOM!, pos) }

  domBoundsAround(from: number, to: number, offset: number) {
    return {from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom!.nextSibling}
  }

  coordsAt(pos: number): Rect {
    return textCoords(this.textDOM!, pos)
  }
}

function textCoords(text: Node, pos: number): Rect {
  let range = document.createRange()
  if (browser.chrome || browser.gecko) {
    // These browsers reliably return valid rectangles for empty ranges
    range.setEnd(text, pos)
    range.setStart(text, pos)
    return range.getBoundingClientRect()
  } else {
    // Otherwise, get the rectangle around a character and take one side
    let extend = pos == 0 ? 1 : -1
    range.setEnd(text, pos + (extend > 0 ? 1 : 0))
    range.setStart(text, pos - (extend < 0 ? 1 : 0))
    let rect = range.getBoundingClientRect()
    let x = extend < 0 ? rect.right : rect.left
    return {left: x, right: x, top: rect.top, bottom: rect.bottom}
  }
}

// Also used for collapsed ranges that don't have a placeholder widget!
export class WidgetView extends InlineView {
  dom!: HTMLElement | null

  static create(widget: WidgetType, length: number, side: number, open: number = 0) {
    return new (widget.customView || WidgetView)(widget, length, side, open)
  }

  constructor(public widget: WidgetType, public length: number, readonly side: number, readonly open: number) {
    super()
  }

  slice(from: number, to: number = this.length) { return WidgetView.create(this.widget, to - from, this.side) }

  sync() {
    if (!this.dom || !this.widget.updateDOM(this.dom)) {
      this.setDOM(this.widget.toDOM(this.editorView))
      this.dom!.contentEditable = "false"
    }
  }

  getSide() { return this.side }

  merge(from: number, to: number = this.length, source: InlineView | null = null) {
    if (source) {
      if (!(source instanceof WidgetView) || !source.open ||
          from > 0 && !(source.open & Open.Start) ||
          to < this.length && !(source.open & Open.End)) return false
      if (!this.widget.compare(source.widget))
        throw new Error("Trying to merge incompatible widgets")
    }
    this.length = from + (source ? source.length : 0) + (this.length - to)
    return true
  }

  match(other: InlineView): boolean {
    if (other.length == this.length && other instanceof WidgetView && other.side == this.side) {
      if (this.widget.constructor == other.widget.constructor) {
        if (!this.widget.eq(other.widget.value)) this.markDirty(true)
        this.widget = other.widget
        return true
      }
    }
    return false
  }

  ignoreMutation(): boolean { return true }
  ignoreEvent(event: Event): boolean { return this.widget.ignoreEvent(event) }

  get overrideDOMText(): readonly string[] | null {
    if (this.length == 0) return [""]
    let top: ContentView = this
    while (top.parent) top = top.parent
    let view = (top as any).editorView, text: Text | undefined = view && view.state.doc, start = this.posAtStart
    return text ? text.sliceLines(start, start + this.length) : [""]
  }

  domAtPos(pos: number) {
    return pos == 0 ? DOMPos.before(this.dom!) : DOMPos.after(this.dom!, pos == this.length)
  }

  domBoundsAround() { return null }

  coordsAt(pos: number): Rect | null {
    let rects = this.dom!.getClientRects()
    for (let i = pos > 0 ? rects.length - 1 : 0;; i += (pos > 0 ? -1 : 1)) {
      let rect = rects[i]
      if (pos > 0 ? i == 0 : i == rects.length - 1 || rect.top < rect.bottom) return rects[i]
    }
    return null
  }
}

export class CompositionView extends WidgetView {
  domAtPos(pos: number) { return new DOMPos(this.widget.value.text, pos) }

  sync() { if (!this.dom) this.setDOM(this.widget.toDOM(this.editorView)) }

  ignoreMutation(): boolean { return false }

  get overrideDOMText() { return null }

  coordsAt(pos: number) { return textCoords(this.widget.value.text, pos) }
}
