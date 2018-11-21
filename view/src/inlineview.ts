import {ContentView, dirty} from "./contentview"
import {WidgetType, attrsEq, DecorationSet, Decoration, RangeDecoration, WidgetDecoration, LineDecoration} from "./decoration"
import {LineWidget, LineView} from "./lineview"
import {Text, TextIterator} from "../../doc/src"
import {RangeIterator, RangeSet} from "../../rangeset/src/rangeset"
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
    super(null, null)
    this.class = clss
  }

  syncInto(parent: HTMLElement, pos: Node | null): Node | null {
    if (!this.dom) {
      let tagName = this.tagName || (this.attrs || this.class ? "span" : null)
      if (!tagName && pos && pos.nodeType == 3 && !nodeAlreadyInTree(this, pos)) this.textDOM = pos
      else this.textDOM = document.createTextNode(this.text)
      if (tagName) {
        this.dom = document.createElement(tagName)
        this.dom.appendChild(this.textDOM)
        if (this.class) (this.dom as HTMLElement).className = this.class
        if (this.attrs) for (let name in this.attrs) (this.dom as HTMLElement).setAttribute(name, this.attrs[name])
      } else {
        this.dom = this.textDOM
      }
      this.dom.cmView = this
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
    let parent = this.parent!, view = new CompositionView(parent, this.dom!, this.textDOM!, this.length)
    this.markParentsDirty()
    let parentIndex = parent.children.indexOf(this)
    return parent.children[parentIndex] = view
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
    super(null, null)
  }

  syncInto(parent: HTMLElement, pos: Node | null): Node | null {
    if (!this.dom) {
      this.dom = this.widget ? this.widget.toDOM() : document.createElement("span")
      this.dom.contentEditable = "false"
      this.dom.cmView = this
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
  constructor(parent: ContentView, dom: Node, public textDOM: Node, public length: number) {
    super(parent, dom)
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

export class LineContent {
  elements: InlineView[] = []
  attrs: null | {[attr: string]: string} = null
  widgets: LineWidget[] = none
  constructor(public atStart: boolean = true) {}

  add(inline: InlineView) {
    this.elements.push(inline)
    if (this.atStart && inline instanceof TextView) this.atStart = false
  }

  addLineDeco(deco: LineDecoration) {
    let attrs = deco.spec.attributes
    if (attrs) {
      if (!this.attrs) this.attrs = {}
      for (let name in attrs) {
        if (name == "class" && Object.prototype.hasOwnProperty.call(this.attrs, "class"))
          this.attrs.class += " " + attrs.class
        else if (name == "style" && Object.prototype.hasOwnProperty.call(this.attrs, "style"))
          this.attrs.style += ";" + attrs.style
        else
          this.attrs[name] = attrs[name]
      }
    }
    if (deco.widget) {
      if (this.widgets == none) this.widgets = []
      let pos = 0
      while (pos < this.widgets.length && this.widgets[pos].side <= deco.side) pos++
      this.widgets.splice(pos, 0, new LineWidget(deco.widget, deco.side))
    }
  }
}

export class InlineBuilder implements RangeIterator<Decoration> {
  lines: LineContent[]
  cursor: TextIterator
  text: string = ""
  skip: number
  textOff: number = 0

  constructor(text: Text, public pos: number) {
    this.cursor = text.iter()
    this.skip = pos
    this.lines = [new LineContent(text.lineAt(pos).start == pos)]
  }

  buildText(length: number, tagName: string | null, clss: string | null, attrs: {[key: string]: string} | null, ranges: Decoration[]) {
    while (length > 0) {
      if (this.textOff == this.text.length) {
        let {value, lineBreak, done} = this.cursor.next(this.skip)
        this.skip = 0
        if (done) throw new Error("Ran out of text content when drawing inline views")
        if (lineBreak) {
          this.lines.push(new LineContent)
          length--
          continue
        } else {
          this.text = value
          this.textOff = 0
        }
      }
      let take = Math.min(this.text.length - this.textOff, length)
      this.curLine.add(new TextView(this.text.slice(this.textOff, this.textOff + take), tagName, clss, attrs))
      length -= take
      this.textOff += take
    }
  }

  advance(pos: number, active: Decoration[]) {
    if (pos <= this.pos) return

    let tagName = null, clss = null
    let attrs: {[key: string]: string} | null = null
    for (let {spec} of active as RangeDecoration[]) {
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

    this.buildText(pos - this.pos, tagName, clss, attrs, active)
    this.pos = pos
  }

  advanceCollapsed(pos: number, deco: Decoration) {
    if (pos <= this.pos) return

    let line = this.curLine
    let widgetView = new WidgetView(pos - this.pos, deco.widget, 0)
    if (!line.elements.length || !line.elements[line.elements.length - 1].merge(widgetView))
      line.add(widgetView)

    // Advance the iterator past the collapsed content
    let length = pos - this.pos
    if (this.textOff + length <= this.text.length) {
      this.textOff += length
    } else {
      this.skip += length - (this.text.length - this.textOff)
      this.text = ""
      this.textOff = 0
    }

    this.pos = pos
  }

  point(deco: Decoration) {
    if (deco instanceof WidgetDecoration)
      this.curLine.add(new WidgetView(0, deco.widget, deco.bias))
    else if (this.curLine.atStart)
      this.curLine.addLineDeco(deco as LineDecoration)
  }

  get curLine() { return this.lines[this.lines.length - 1] }

  ignoreRange(deco: RangeDecoration): boolean { return false }
  ignorePoint(deco: Decoration): boolean { return false }

  static build(text: Text, from: number, to: number, decorations: ReadonlyArray<DecorationSet>): LineContent[] {
    let builder = new InlineBuilder(text, from)
    RangeSet.iterateSpans(decorations, from, to, builder)
    return builder.lines
  }
}

function nodeAlreadyInTree(view: ContentView, node: Node): boolean {
  let v = node.cmView
  return v ? v.root == view.root : false
}
