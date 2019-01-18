import {ContentView, ChildCursor, syncNodeInto} from "./contentview"
import {DocView} from "./docview"
import {InlineView, TextView, CompositionView} from "./inlineview"
import {clientRectsFor, Rect, domIndex} from "./dom"
import {WidgetType, LineDecoration} from "./decoration"
import {combineAttrs, attrsEq, updateAttrs} from "./attributes"

export class LineView extends ContentView {
  children: InlineView[] = []
  widgets: LineWidget[] = none
  length: number = 0
  dom!: HTMLElement | null
  prevAttrs: {[name: string]: string} | null | undefined = undefined
  attrs: {[name: string]: string} | null = null

  // Consumes source
  merge(from: number, to: number = this.length, source: LineView, takeDeco: boolean) {
    if (takeDeco) this.setDeco(source)
    if (!this.dom) source.transferDOM(this) // Reuse source.dom when appropriate

    let elts = source.children
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
    while (fromI < toI && elts.length && this.children[toI - 1].match(elts[elts.length - 1])) {
      elts.pop()
      toI--
    }
    while (fromI < toI && elts.length && this.children[fromI].match(elts[0])) {
      elts.shift()
      fromI++
    }

    if (fromI < toI && (this.parent as DocView).composition) {
      // If there's a zero-length composition on the edge of the update, don't overwrite it
      if (this.children[toI - 1] instanceof CompositionView && this.children[toI - 1].length == 0) toI--
      else if (this.children[fromI] instanceof CompositionView && this.children[fromI].length == 0) fromI++
    }

    // And if anything remains, splice the child array to insert the new elts
    if (elts.length || fromI != toI) this.replaceChildren(fromI, toI, elts)
  }

  split(at: number) {
    let end = new LineView
    if (this.length == 0) return end
    let {i, off} = new ChildCursor(this.children, this.length).findPos(at)
    if (off) {
      end.append(this.children[i].slice(off))
      this.children[i].cut(off)
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

  setDeco(source: LineView) {
    if (!attrsEq(this.attrs, source.attrs)) {
      if (this.dom) {
        this.prevAttrs = this.attrs
        this.markDirty()
      }
      this.attrs = source.attrs
    }
    // Reconcile the new widgets with the existing ones
    for (let i = 0, j = 0;;) {
      let a = i == this.widgets.length ? null : this.widgets[i]
      let b = j == source.widgets.length ? null : source.widgets[j]
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

  // Only called when building a line view in ContentBuilder
  append(child: InlineView) {
    this.children.push(child)
    child.setParent(this)
    this.length += child.length
  }

  // Only called when building a line view in ContentBuilder
  addLineDeco(deco: LineDecoration) {
    let attrs = deco.spec.attributes
    if (attrs)
      this.attrs = combineAttrs(attrs, this.attrs || {})
    if (deco.widget) {
      if (this.widgets == none) this.widgets = []
      let pos = 0
      while (pos < this.widgets.length && this.widgets[pos].side <= deco.side) pos++
      this.widgets.splice(pos, 0, new LineWidget(deco.widget, deco.side))
    }
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = new ChildCursor(this.children, this.length).findPos(pos)
    if (off) {
      let textDOM: Node | null = (this.children[i] as any).textDOM
      if (textDOM) return {node: textDOM, offset: off}
    }
    while (i > 0 && (this.children[i - 1].getSide() > 0 || this.children[i - 1].dom!.parentNode != this.dom)) i--
    return {node: this.dom!, offset: i ? domIndex(this.children[i - 1].dom!) + 1 : 0}
  }

  syncInto(parent: HTMLElement, pos: Node | null): Node | null {
    if (!this.dom) {
      this.setDOM(document.createElement("div"))
      this.dom!.className = "codemirror-line"
      if (this.attrs) this.prevAttrs = null
      for (let w of this.widgets) if (!w.dom) w.finish()
    }
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
      updateAttrs(this.dom!, this.prevAttrs, this.attrs)
      this.dom!.classList.add("codemirror-line")
      this.prevAttrs = undefined
    }
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
    if (this.length == 0) return (this.dom!.lastChild as HTMLElement).getBoundingClientRect()
    return super.coordsAt(pos)
  }

  // Ignore mutations in line widgets
  ignoreMutation(rec: MutationRecord): boolean {
    return !this.dom!.contains(rec.target.nodeType == 1 ? rec.target : rec.target.parentNode!)
  }

  // Find the appropriate widget, and ask it whether an event needs to be ignored
  ignoreEvent(event: Event): boolean {
    if (this.widgets.length == 0 || this.dom!.contains(event.target as Node)) return false
    for (let widget of this.widgets)
      if (widget.dom!.contains(event.target as Node))
        return widget.widget.ignoreEvent(event)
    return true
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
