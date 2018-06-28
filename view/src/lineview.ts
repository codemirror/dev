import {ContentView, ChildCursor} from "./contentview"
import {DocView} from "./docview"
import {InlineView, TextView, WidgetView, CollapsedView} from "./inlineview"
import {clientRectsFor} from "./dom"
import {DecorationSet, WidgetType, RangeDesc, buildLineElements} from "./decoration"
import {Text, TextCursor} from "../../doc/src/text"

export class LineView extends ContentView {
  children: InlineView[]
  length: number
  dom!: HTMLElement

  constructor(parent: DocView, content: InlineView[]) {
    super(parent, document.createElement("div"))
    this.length = 0
    this.children = []
    if (content.length) this.update(0, 0, content)
    this.markDirty()
  }

  update(from: number, to: number = this.length, content: InlineView[]) {
    this.markDirty()
    let cur = new ChildCursor(this.children, this.length)
    let {i: toI, off: toOff} = cur.findPos(to, 1)
    let {i: fromI, off: fromOff} = cur.findPos(from, -1)
    let dLen = from - to
    for (let view of content) dLen += view.length
    this.length += dLen

    // Both from and to point into the same text view
    if (fromI == toI && fromOff) {
      let start = this.children[fromI] as TextView
      // Maybe just update that view and be done
      if (content.length == 1 && start.merge(content[0], fromOff, toOff)) return
      if (content.length == 0) return start.cut(fromOff, toOff)
      // Otherwise split it, so that we don't have to worry about aliasting front/end afterwards
      InlineView.appendInline(content, [new TextView(start.text.slice(toOff), start.tagName, start.class, start.attrs)])
      toI++
      toOff = 0
    }

    // Make sure start and end positions fall on node boundaries
    // (fromOff/toOff are no longer used after this), and that if the
    // start or end of the content can be merged with adjacent nodes,
    // this is done
    if (toOff) {
      let end = this.children[toI] as TextView
      if (content.length && end.merge(content[content.length - 1], 0, toOff)) content.pop()
      else end.cut(0, toOff)
    } else if (toI < this.children.length && content.length &&
               this.children[toI].merge(content[content.length - 1], 0, 0)) {
      content.pop()
    }
    if (fromOff) {
      let start = this.children[fromI] as TextView
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
      this.children.splice(fromI, toI - fromI, ...content)
    }
  }

  detachTail(from: number): TextView[] {
    let result: TextView[] = []
    if (this.length == 0) return result
    let {i, off} = new ChildCursor(this.children, this.length).findPos(from)
    if (off > 0) {
      let child = this.children[i] as TextView
      result.push(new TextView(child.text.slice(off), child.tagName, child.class, child.attrs))
      child.cut(off)
      i++
    }
    if (i < this.children.length) {
      for (let j = i; j < this.children.length; j++) result.push(this.children[j] as TextView)
      this.children.length = i
      this.markDirty()
    }
    this.length = from
    return result
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = new ChildCursor(this.children, this.length).findPos(pos)
    while (off == 0 && i > 0 && this.children[i - 1].getSide() > 0) i--
    if (off == 0) return {node: this.dom, offset: i}
    let child = this.children[i]
    if (child instanceof TextView) return {node: child.textDOM!, offset: off}
    else return {node: this.dom, offset: i}
  }

  // FIXME might need another hack to work around Firefox's behavior
  // of not actually displaying the cursor even though it's there in
  // the DOM
  sync() {
    super.sync()
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
}

export class LineElementBuilder {
  elements: InlineView[][] = [[]];
  active: RangeDesc[] = [];
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

  advance(pos: number) {
    if (pos <= this.pos) return

    let tagName = null, clss = null
    let attrs: {[key: string]: string} | null = null
    for (let desc of this.active) {
      let spec = desc.spec
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
    this.buildText(pos - this.pos, tagName, clss, attrs)
    this.pos = pos
  }

  advanceCollapsed(pos: number) {
    if (pos > this.pos) {
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
  }

  addWidget(widget: WidgetType<any>, side: number) {
    this.elements[this.elements.length - 1].push(new WidgetView(widget, side))
  }

  static build(text: Text, from: number, to: number, decorations: ReadonlyArray<DecorationSet>): InlineView[][] {
    let builder = new LineElementBuilder(text, from)
    buildLineElements(decorations, from, to, builder)
    return builder.elements
  }
}
