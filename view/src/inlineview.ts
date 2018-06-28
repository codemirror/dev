import {ContentView, dirty} from "./contentview"
import {WidgetType, attrsEq} from "./decoration"

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
}

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
}

