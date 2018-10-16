import {ContentView, ChildCursor, syncNodeInto} from "./contentview"
import {DocView} from "./docview"
import {InlineView, TextView} from "./inlineview"
import {clientRectsFor, Rect, domIndex} from "./dom"
import {attrsEq, WidgetType} from "./decoration"

export class LineView extends ContentView {
  children: InlineView[]
  widgets: LineWidget[] = none
  length: number
  dom!: HTMLElement
  prevAttrs: {[name: string]: string} | null | undefined = undefined

  constructor(parent: DocView, content: InlineView[], public attrs: {[name: string]: string} | null) {
    super(parent, document.createElement("div"))
    if (attrs) setAttrs(this.dom, attrs)
    this.length = 0
    this.children = []
    if (content.length) this.update(0, 0, content)
    this.markDirty()
  }

  setAttrs(attrs: {[name: string]: string} | null) {
    if (!attrsEq(this.attrs, attrs)) {
      this.prevAttrs = this.attrs
      this.attrs = attrs
      this.markDirty()
    }
  }

  update(from: number, to: number = this.length, content: InlineView[]) {
    let cur = new ChildCursor(this.children, this.length)
    let {i: toI, off: toOff} = cur.findPos(to, 1)
    let {i: fromI, off: fromOff} = cur.findPos(from, -1)
    let dLen = from - to
    for (let view of content) dLen += view.length
    this.length += dLen

    // Both from and to point into the same text view
    if (fromI == toI && fromOff) {
      let start = this.children[fromI]
      // Maybe just update that view and be done
      if (content.length == 1 && start.merge(content[0], fromOff, toOff)) return
      if (content.length == 0) return start.cut(fromOff, toOff)
      // Otherwise split it, so that we don't have to worry about aliasting front/end afterwards
      InlineView.appendInline(content, [start.slice(toOff)])
      toI++
      toOff = 0
    }

    // Make sure start and end positions fall on node boundaries
    // (fromOff/toOff are no longer used after this), and that if the
    // start or end of the content can be merged with adjacent nodes,
    // this is done
    if (toOff) {
      let end = this.children[toI]
      if (content.length && end.merge(content[content.length - 1], 0, toOff)) content.pop()
      else end.cut(0, toOff)
    } else if (toI < this.children.length && content.length &&
               this.children[toI].merge(content[content.length - 1], 0, 0)) {
      content.pop()
    }
    if (fromOff) {
      let start = this.children[fromI]
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
      for (let view of content) view.finish(this)
      this.replaceChildren(fromI, toI, content)
    }
  }

  detachTail(from: number): InlineView[] {
    let result: InlineView[] = []
    if (this.length == 0) return result
    let {i, off} = new ChildCursor(this.children, this.length).findPos(from)
    if (off > 0) {
      let child = this.children[i]
      result.push(child.slice(off))
      child.cut(off)
      i++
    }
    if (i < this.children.length) {
      for (let j = i; j < this.children.length; j++) result.push(this.children[j])
      this.replaceChildren(i, this.children.length)
    }
    this.length = from
    return result
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = new ChildCursor(this.children, this.length).findPos(pos)
    if (off) {
      let child = this.children[i]
      if (child instanceof TextView) return {node: child.textDOM!, offset: off}
    }
    while (i > 0 && (this.children[i - 1].getSide() > 0 || this.children[i - 1].dom!.parentNode != this.dom)) i--
    return {node: this.dom, offset: i ? domIndex(this.children[i - 1].dom!) + 1 : 0}
  }

  syncInto(parent: HTMLElement, pos: Node | null): Node | null {
    for (let i = 0, main = false;; i++) {
      let widget = i == this.widgets.length ? null : this.widgets[i]
      if (!main && (!widget || widget.side > 0)) {
        main = true
        pos = syncNodeInto(parent, pos, this.dom!)
      }
      if (!widget) break
      pos = syncNodeInto(parent, pos, widget.dom)
    }
    return pos
  }

  // FIXME might need another hack to work around Firefox's behavior
  // of not actually displaying the cursor even though it's there in
  // the DOM
  sync() {
    super.sync()
    if (this.prevAttrs !== undefined) {
      removeAttrs(this.dom, this.prevAttrs)
      setAttrs(this.dom, this.attrs)
      this.prevAttrs = undefined
    }
    let last = this.dom.lastChild
    if (!last || last.nodeName == "BR") {
      let hack = document.createElement("BR")
      hack.cmIgnore = true
      this.dom.appendChild(hack)
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
    return {lineHeight: this.dom.getBoundingClientRect().height,
            charWidth: totalWidth / this.length}
  }

  coordsAt(pos: number): Rect | null {
    if (this.length == 0) return (this.dom.lastChild as HTMLElement).getBoundingClientRect()
    return super.coordsAt(pos)
  }
}

class LineWidget {
  dom: HTMLElement
  constructor(readonly widget: WidgetType<any>, readonly side: number) {
    this.dom = widget.toDOM()
  }
  eq(other: LineWidget) {
    return this.widget.compare(other.widget) && this.side == other.side
  }
}

const none: any[] = []

function setAttrs(dom: HTMLElement, attrs: {[name: string]: string} | null) {
  if (attrs) for (let name in attrs) dom.setAttribute(name, attrs[name])
}

function removeAttrs(dom: HTMLElement, attrs: {[name: string]: string} | null) {
  if (attrs) for (let name in attrs) dom.removeAttribute(name)
}
