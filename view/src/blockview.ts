import {ContentView, DOMPos} from "./contentview"
import {DocView} from "./docview"
import {InlineView, TextView, WidgetView, mergeInlineChildren, inlineDOMAtPos, joinInlineInto} from "./inlineview"
import {clientRectsFor, Rect} from "./dom"
import {LineDecoration, WidgetType, BlockType} from "./decoration"
import {Attrs, combineAttrs, attrsEq, updateAttrs} from "./attributes"
import {themeClass} from "./theme"
import {Text} from "@codemirror/next/state"

export interface BlockView extends ContentView {
  merge(from: number, to: number, source: ContentView | null, takeDeco: boolean, openStart: number, openEnd: number): boolean
  match(other: BlockView): boolean
  split(at: number): BlockView
  type: BlockType
  dom: HTMLElement | null
}

const LineClass = themeClass("line")

export class LineView extends ContentView implements BlockView {
  children: InlineView[] = []
  length: number = 0
  dom!: HTMLElement | null
  prevAttrs: Attrs | null | undefined = undefined
  attrs: Attrs | null = null
  breakAfter = 0

  // Consumes source
  merge(from: number, to: number, source: BlockView | null, takeDeco: boolean, openStart: number, openEnd: number): boolean {
    if (source) {
      if (!(source instanceof LineView)) return false
      if (!this.dom) source.transferDOM(this) // Reuse source.dom when appropriate
    }
    if (takeDeco) this.setDeco(source ? source.attrs : null)
    mergeInlineChildren(this, from, to, source ? source.children : none, openStart, openEnd)
    return true
  }

  split(at: number) {
    let end = new LineView
    end.breakAfter = this.breakAfter
    if (this.length == 0) return end
    let {i, off} = this.childPos(at)
    if (off) {
      end.append(this.children[i].slice(off), 0)
      this.children[i].merge(off, this.children[i].length, null, 0, 0)
      i++
    }
    for (let j = i; j < this.children.length; j++) end.append(this.children[j], 0)
    while (i > 0 && this.children[i - 1].length == 0) { this.children[i - 1].parent = null; i-- }
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
  append(child: InlineView, openStart: number) {
    joinInlineInto(this, child, openStart)
  }

  // Only called when building a line view in ContentBuilder
  addLineDeco(deco: LineDecoration) {
    let attrs = deco.spec.attributes
    if (attrs) this.attrs = combineAttrs(attrs, this.attrs || {})
  }

  domAtPos(pos: number): DOMPos {
    return inlineDOMAtPos(this.dom!, this.children, pos)
  }

  // FIXME might need another hack to work around Firefox's behavior
  // of not actually displaying the cursor even though it's there in
  // the DOM
  sync(track?: {node: Node, written: boolean}) {
    if (!this.dom) {
      this.setDOM(document.createElement("div"))
      this.dom!.className = LineClass
      this.prevAttrs = this.attrs ? null : undefined
    }
    if (this.prevAttrs !== undefined) {
      updateAttrs(this.dom!, this.prevAttrs, this.attrs)
      this.dom!.classList.add(LineClass)
      this.prevAttrs = undefined
    }
    super.sync(track)
    let last = this.dom!.lastChild
    if (!last || (last.nodeName != "BR" && (ContentView.get(last) instanceof WidgetView))) {
      let hack = document.createElement("BR")
      ;(hack as any).cmIgnore = true
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

  coordsAt(pos: number, side: number): Rect | null {
    for (let off = 0, i = 0; i < this.children.length; i++) {
      let child = this.children[i], end = off + child.length
      if (end != off && (side <= 0 || end == this.length ? end >= pos : end > pos))
        return child.coordsAt(pos - off, side)
      off = end
    }
    return (this.dom!.lastChild as HTMLElement).getBoundingClientRect()
  }

  match(_other: ContentView) { return false }

  get type() { return BlockType.Text }

  static find(docView: DocView, pos: number): LineView | null {
    for (let i = 0, off = 0;; i++) {
      let block = docView.children[i], end = off + block.length
      if (end >= pos) {
        if (block instanceof LineView) return block
        if (block.length) return null
      }
      off = end + block.breakAfter
    }
  }
}

const none = [] as any

export class BlockWidgetView extends ContentView implements BlockView {
  dom!: HTMLElement | null
  parent!: DocView | null
  breakAfter = 0

  constructor(public widget: WidgetType, public length: number, public type: BlockType) {
    super()
  }

  merge(from: number, to: number, source: ContentView | null, _takeDeco: boolean, openStart: number, openEnd: number): boolean {
    if (!(source instanceof BlockWidgetView) || !this.widget.compare(source.widget) ||
        from > 0 && openStart <= 0 || to < this.length && openEnd <= 0)
      return false
    this.length = from + source.length + (this.length - to)
    return true
  }

  domAtPos(pos: number) {
    return pos == 0 ? DOMPos.before(this.dom!) : DOMPos.after(this.dom!, pos == this.length)
  }

  split(at: number) {
    let len = this.length - at
    this.length = at
    return new BlockWidgetView(this.widget, len, this.type)
  }

  get children() { return none }

  sync() {
    if (!this.dom || !this.widget.updateDOM(this.dom)) {
      this.setDOM(this.widget.toDOM(this.editorView))
      this.dom!.contentEditable = "false"
    }
  }

  get overrideDOMText() {
    return this.parent ? this.parent!.view.state.doc.slice(this.posAtStart, this.posAtEnd) : Text.empty
  }

  domBoundsAround() { return null }

  match(other: ContentView) {
    if (other instanceof BlockWidgetView && other.type == this.type &&
        other.widget.constructor == this.widget.constructor) {
      if (!other.widget.eq(this.widget.value)) this.markDirty(true)
      this.widget = other.widget
      this.length = other.length
      this.breakAfter = other.breakAfter
      return true
    }
    return false
  }
}
