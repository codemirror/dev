import {ContentView, dirty} from "./contentview"
import {WidgetType, attrsEq} from "./decoration"
import {LineView} from "./lineview"
import {Text} from "../../doc/src"
import {Rect} from "./dom"
import browser from "./browser"

const none: any[] = []

export abstract class InlineView extends ContentView {
  merge(other: InlineView, from?: number, to?: number) { return false }
  get children() { return none }
  cut(from: number, to?: number) { throw "Not implemented" }
  slice(from: number, to?: number): InlineView { throw "Not implemented" }
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
              clss: string | null,
              public attrs: {[key: string]: string} | null) {
    super()
    this.class = clss
  }

  syncInto(parent: HTMLElement, pos: Node | null): Node | null {
    if (!this.dom) {
      let tagName = this.tagName || (this.attrs || this.class ? "span" : null)
      if (!tagName && pos && pos.nodeType == 3 && !nodeAlreadyInTree(this, pos)) this.textDOM = pos
      else this.textDOM = document.createTextNode(this.text)
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
    return super.syncInto(parent, pos)
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

  slice(from: number, to: number = this.length) {
    return new TextView(this.text.slice(from, to), this.tagName, this.class, this.attrs)
  }

  localPosFromDOM(node: Node, offset: number): number {
    return node == this.textDOM ? offset : offset ? this.text.length : 0
  }

  domFromPos(pos: number) { return {node: this.textDOM!, offset: pos} }

  domBoundsAround(from: number, to: number, offset: number) {
    return {from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom!.nextSibling}
  }

  coordsAt(pos: number): Rect { return textCoords(this.textDOM!, pos) }

  toCompositionView() {
    let parent = this.parent!, view = new CompositionView(this.dom!, this.textDOM!, this.length)
    this.markParentsDirty()
    let parentIndex = parent.children.indexOf(this)
    return parent.children[parentIndex] = view
    view.setParent(parent)
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

  constructor(public length: number, readonly widget: WidgetType<any> | null, readonly side: number) {
    super()
  }

  syncInto(parent: HTMLElement, pos: Node | null): Node | null {
    if (!this.dom) {
      this.setDOM(this.widget ? this.widget.toDOM() : document.createElement("span"))
      this.dom!.contentEditable = "false"
    }
    return super.syncInto(parent, pos)
  }

  cut(from: number, to: number = this.length) { this.length -= to - from }
  slice(from: number, to: number = this.length) { return new WidgetView(to - from, this.widget, this.side) }

  sync() { this.dirty = dirty.not }

  getSide() { return this.side }

  merge(other: InlineView, from: number = 0, to: number = this.length): boolean {
    if (!(other instanceof WidgetView) || this.widget || other.widget) return false
    this.length = from + other.length + (this.length - to)
    return true
  }

  ignoreMutation(): boolean { return true }
  ignoreEvent(event: Event): boolean { return this.widget ? this.widget.ignoreEvent(event) : false }

  get overrideDOMText() {
    if (this.length == 0) return [""]
    let top: ContentView = this
    while (top.parent) top = top.parent
    let text: Text = (top as any).text, start = this.posAtStart
    return text ? text.sliceLines(start, start + this.length) : [""]
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

export class CompositionView extends InlineView {
  constructor(dom: Node, public textDOM: Node, public length: number) {
    super()
    this.setDOM(dom)
  }

  updateLength(newLen: number) {
    if (this.parent) (this.parent as LineView).length += newLen - this.length
    this.length = newLen
  }

  sync() {}

  localPosFromDOM(node: Node, offset: number): number {
    return node == this.textDOM ? offset : offset ? this.length : 0
  }

  domFromPos(pos: number) { return {node: this.textDOM!, offset: pos} }

  domBoundsAround(from: number, to: number, offset: number) {
    return {from: offset, to: offset + this.length, startDOM: this.dom, endDOM: this.dom!.nextSibling}
  }

  coordsAt(pos: number): Rect { return textCoords(this.textDOM, pos) }
}

function nodeAlreadyInTree(view: ContentView, node: Node): boolean {
  let v = node.cmView
  return v ? v.root == view.root : false
}
