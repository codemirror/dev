import {Text} from "@codemirror/next/text"
import {ContentView, DOMPos} from "./contentview"
import {WidgetType} from "./decoration"
import {attrsEq} from "./attributes"
import {Rect} from "./dom"
import browser from "./browser"
import {Open} from "./buildview"

const none: any[] = []

export abstract class InlineView extends ContentView {
  abstract merge(from: number, to?: number, source?: InlineView | null): boolean
  match(_other: InlineView) { return false }
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

  domBoundsAround(_from: number, _to: number, offset: number) {
    return {from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom!.nextSibling}
  }

  coordsAt(pos: number, side: number): Rect {
    return textCoords(this.textDOM!, pos, side, this.length)
  }
}

function textCoords(text: Node, pos: number, side: number, length: number): Rect {
  let from = pos, to = pos
  if (pos == 0 && side < 0 || pos == length && side >= 0) {
    if (!(browser.webkit || browser.gecko)) { // These browsers reliably return valid rectangles for empty ranges
      if (pos) from--; else to++
    }
  } else {
    if (side < 0) from--; else to++
  }
  let range = document.createRange()
  range.setEnd(text, to)
  range.setStart(text, from)
  return range.getBoundingClientRect()
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

  get overrideDOMText(): Text | null {
    if (this.length == 0) return Text.empty
    let top: ContentView = this
    while (top.parent) top = top.parent
    let view = (top as any).editorView, text: Text | undefined = view && view.state.doc, start = this.posAtStart
    return text ? text.slice(start, start + this.length) : Text.empty
  }

  domAtPos(pos: number) {
    return pos == 0 ? DOMPos.before(this.dom!) : DOMPos.after(this.dom!, pos == this.length)
  }

  domBoundsAround() { return null }

  coordsAt(pos: number, _side: number): Rect | null {
    let rects = this.dom!.getClientRects(), rect: Rect | null = null
    for (let i = pos > 0 ? rects.length - 1 : 0;; i += (pos > 0 ? -1 : 1)) {
      rect = rects[i]
      if (pos > 0 ? i == 0 : i == rects.length - 1 || rect.top < rect.bottom) break
    }
    return rect
  }
}

export class CompositionView extends WidgetView {
  domAtPos(pos: number) { return new DOMPos(this.widget.value.text, pos) }

  sync() { if (!this.dom) this.setDOM(this.widget.toDOM(this.editorView)) }

  ignoreMutation(): boolean { return false }

  get overrideDOMText() { return null }

  coordsAt(pos: number, side: number) { return textCoords(this.widget.value.text, pos, side, this.length) }
}
