import {ContentView, ChildCursor, syncNodeInto} from "./contentview"
import {DocView} from "./docview"
import {InlineView, TextView, LineContent} from "./inlineview"
import {clientRectsFor, Rect, domIndex} from "./dom"
import {attrsEq, WidgetType} from "./decoration"

export class LineView extends ContentView {
  children: InlineView[]
  widgets: LineWidget[] = none
  length: number
  dom!: HTMLElement
  prevAttrs: {[name: string]: string} | null | undefined = undefined
  attrs: {[name: string]: string} | null = null

  constructor(parent: DocView, content?: LineContent, tail?: InlineView[]) {
    super(parent, document.createElement("div"))
    this.length = 0
    this.children = []
    if (content) this.update(0, 0, content, tail)
    this.markDirty()
  }

  setDeco(content: LineContent) {
    if (!attrsEq(this.attrs, content.attrs)) {
      this.prevAttrs = this.attrs
      this.attrs = content.attrs
      this.markDirty()
    }
    // Reconcile the new widgets with the existing ones
    for (let i = 0, j = 0;;) {
      let a = i == this.widgets.length ? null : this.widgets[i]
      let b = j == content.widgets.length ? null : content.widgets[j]
      if (!a && !b) break
      if (a && b && a.eq(b)) {
        i++; j++
      } else if (!a || (b && b.side <= a.side)) {
        if (this.widgets == none) this.widgets = []
        this.widgets.splice(i++, 0, b!.finish())
        this.parent!.markDirty()
        j++
      } else {
        this.widgets.splice(i, 1)
        this.parent!.markDirty()
      }
    }
  }

  update(from: number, to: number = this.length, content: LineContent, tail?: InlineView[]) {
    if (from == 0) this.setDeco(content)
    let elts = tail ? InlineView.appendInline(content.elements, tail) : content.elements
    let cur = new ChildCursor(this.children, this.length)
    let {i: toI, off: toOff} = cur.findPos(to, 1)
    let {i: fromI, off: fromOff} = cur.findPos(from, -1)
    let dLen = from - to
    for (let view of elts) dLen += view.length
    this.length += dLen

    // Both from and to point into the same text view
    if (fromI == toI && fromOff) {
      let start = this.children[fromI]
      // Maybe just update that view and be done
      if (elts.length == 1 && start.merge(elts[0], fromOff, toOff)) return
      if (elts.length == 0) return start.cut(fromOff, toOff)
      // Otherwise split it, so that we don't have to worry about aliasting front/end afterwards
      InlineView.appendInline(elts, [start.slice(toOff)])
      toI++
      toOff = 0
    }

    // Make sure start and end positions fall on node boundaries
    // (fromOff/toOff are no longer used after this), and that if the
    // start or end of the elts can be merged with adjacent nodes,
    // this is done
    if (toOff) {
      let end = this.children[toI]
      if (elts.length && end.merge(elts[elts.length - 1], 0, toOff)) elts.pop()
      else end.cut(0, toOff)
    } else if (toI < this.children.length && elts.length &&
               this.children[toI].merge(elts[elts.length - 1], 0, 0)) {
      elts.pop()
    }
    if (fromOff) {
      let start = this.children[fromI]
      if (elts.length && start.merge(elts[0], fromOff)) elts.shift()
      else start.cut(fromOff)
      fromI++
    } else if (fromI && elts.length && this.children[fromI - 1].merge(elts[0], this.children[fromI - 1].length)) {
      elts.shift()
    }

    // Then try to merge any mergeable nodes at the start and end of
    // the changed range
    while (fromI < toI && elts.length && this.children[toI - 1].merge(elts[elts.length - 1])) {
      elts.pop()
      toI--
    }
    while (fromI < toI && elts.length && this.children[fromI].merge(elts[0])) {
      elts.shift()
      fromI++
    }

    // And if anything remains, splice the child array to insert the new elts
    if (elts.length || fromI != toI) {
      for (let view of elts) view.finish(this)
      this.replaceChildren(fromI, toI, elts)
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
      pos = syncNodeInto(parent, pos, widget.dom!)
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

  // Ignore mutations in line widgets
  ignoreMutation(rec: MutationRecord): boolean {
    return !this.dom.contains(rec.target.nodeType == 1 ? rec.target : rec.target.parentNode!)
  }

  // Find the appropriate widget, and ask it whether an event needs to be ignored
  ignoreEvent(event: Event): boolean {
    if (this.widgets.length == 0 || this.dom.contains(event.target as Node)) return false
    for (let widget of this.widgets)
      if (widget.dom!.contains(event.target as Node))
        return widget.widget.ignoreEvent(event)
    return true
  }
}

export class LineWidget {
  dom: HTMLElement | null = null
  constructor(readonly widget: WidgetType<any>, readonly side: number) {}
  eq(other: LineWidget) {
    return this.widget.compare(other.widget) && this.side == other.side
  }
  finish() {
    this.dom = this.widget.toDOM()
    this.dom.cmIgnore = true
    return this
  }
}

const none: any[] = []

function setAttrs(dom: HTMLElement, attrs: {[name: string]: string} | null) {
  if (attrs) for (let name in attrs) dom.setAttribute(name, attrs[name])
}

function removeAttrs(dom: HTMLElement, attrs: {[name: string]: string} | null) {
  if (attrs) for (let name in attrs) dom.removeAttribute(name)
}
