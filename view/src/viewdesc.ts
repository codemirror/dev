import {Text} from "../../doc/src/text"
import {changedRanges, ChangedRange} from "../../doc/src/diff"
import {Plugin} from "../../state/src/state"
import {DecorationSet, joinRanges, attrsEq, Widget, RangeDesc, buildLineElements} from "./decoration"

declare global {
  interface Node { cmView: ViewDesc | undefined; cmIgnore: boolean | undefined }
}

const NOT_DIRTY = 0, CHILD_DIRTY = 1, NODE_DIRTY = 2

export abstract class ViewDesc {
  constructor(public parent: ViewDesc | null, public dom: Node | null) {
    if (dom) dom.cmView = this
  }

  abstract length: number;
  abstract children: ViewDesc[];
  dirty: number = NOT_DIRTY;

  get childGap() { return 0 }
  get ignoreDOMText() { return false }

  get posAtStart(): number {
    return this.parent ? this.parent.posBefore(this) : 0
  }

  get posAtEnd(): number {
    return this.posAtStart + this.length
  }

  posBefore(desc: ViewDesc): number {
    for (let i = 0, pos = this.posAtStart; i < this.children.length; i++) {
      let child = this.children[i]
      if (child == desc) return pos
      pos += child.length + this.childGap
    }
    throw new RangeError("Invalid child in posBefore")
  }

  posAfter(desc: ViewDesc): number {
    return this.posBefore(desc) + desc.length
  }

  syncDOMChildren() {
    if (!this.dom) return
    let dom = this.dom.firstChild
    for (let i = 0; i < this.children.length; i++) {
      let desc = this.children[i], childDOM = desc.dom
      if (!childDOM) continue
      if (childDOM.parentNode == this.dom) {
        while (childDOM != dom) dom = rm(dom!)
        dom = dom.nextSibling
      } else {
        this.dom.insertBefore(childDOM, dom)
      }
    }
    while (dom) dom = rm(dom)
  }

  sync() {
    if (this.dirty & NODE_DIRTY)
      this.syncDOMChildren()
    if (this.dirty & CHILD_DIRTY)
      for (let i = 0; i < this.children.length; i++) this.children[i].sync()
    this.dirty = NOT_DIRTY
  }

  localPosFromDOM(node: Node, offset: number): number {
    let after: Node | null
    if (node == this.dom) {
      after = this.dom.childNodes[offset]
    } else {
      let bias = !node.firstChild ? 0 : offset == 0 ? -1 : 1
      for (;;) {
        let parent = node.parentNode!
        if (parent == this.dom) break
        if (bias == 0 && parent.firstChild != parent.lastChild) {
          if (node == parent.firstChild) bias = -1
          else bias = 1
        }
        node = parent
      }
      if (bias < 0) after = node
      else after = node.nextSibling
    }
    if (!after) return this.length

    for (let i = 0, pos = 0;; i++) {
      let child = this.children[i]
      if (child.dom == after) return pos
      pos += child.length + this.childGap
    }
  }

  markDirty() {
    if (this.dirty & NODE_DIRTY) return
    this.dirty |= NODE_DIRTY
    for (let parent = this.parent; parent; parent = parent.parent) {
      if (parent.dirty & CHILD_DIRTY) return
      parent.dirty |= CHILD_DIRTY
    }
  }
}

// Remove a DOM node and return its next sibling.
function rm(dom: Node): Node {
  let next = dom.nextSibling
  dom.parentNode!.removeChild(dom)
  return next!
}

export type PluginDeco = {plugin: Plugin | null, decorations: DecorationSet}

export class DocViewDesc extends ViewDesc {
  children: LineViewDesc[];
  decorations: PluginDeco[] = [];

  get length() { return this.text.length }
  get childGap() { return 1 }

  constructor(public text: Text, decorations: PluginDeco[], dom: Element) {
    super(null, dom)
    this.children = [new LineViewDesc(this, [])]
    this.dirty = NODE_DIRTY
    this.text = Text.create("")
    this.update(text, decorations)
    this.sync()
  }

  update(text: Text, decorations: PluginDeco[]) {
    let prevText = this.text
    let plan = extendForChangedDecorations(changedRanges(prevText, text), decorations, this.decorations)
    this.text = text
    this.decorations = decorations

    let cur = new ChildCursor(this.children, prevText.length, 1)
    for (let i = plan.length - 1; i >= 0; i--) {
      let {fromA, toA, fromB, toB} = plan[i]
      let {i: toI, off: toOff} = cur.findPos(toA)
      let {i: fromI, off: fromOff} = cur.findPos(fromA)
      let builder = new LineElementBuilder(linesBetween(text, fromB, toB), fromB)
      buildLineElements(decorations.map(d => d.decorations), fromB, toB, builder)
      let lines = builder.elements

      if (lines.length == 1) {
        if (fromI == toI) { // Change within single line
          this.children[fromI].update(fromOff, toOff, lines[0])
        } else { // Join lines
          let tail = this.children[toI].detachTail(toOff)
          this.children[fromI].update(fromOff, undefined, appendLineElements(lines[0], tail))
          this.children.splice(fromI + 1, toI - fromI)
          this.markDirty()
        }
      } else { // Across lines
        let tail = this.children[toI].detachTail(toOff)
        this.children[fromI].update(fromOff, undefined, lines[0])
        let insert = []
        for (let j = 1; j < lines.length; j++)
          insert.push(new LineViewDesc(this, j < lines.length - 1 ? lines[j] : appendLineElements(lines[j], tail)))
        this.children.splice(fromI + 1, toI - fromI, ...insert)
        this.markDirty()
      }
    }
  }

  readDOMRange(from: number, to: number): {from: number, to: number, text: string} {
    // FIXME partially parse lines when possible
    let fromI = -1, fromStart = -1, toI = -1, toEnd = -1
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      /*      if (pos < from && end > to) {
        let result = child.parseRange(from - pos, to - pos)
        return {from: result.from + pos, to: result.to + pos, text: result.text}
      }*/
      if (end >= from && fromI == -1) { fromI = i; fromStart = pos }
      if (end >= to && toI == -1) { toI = i; toEnd = end; break }
      pos = end + 1
    }
    let startDOM = (fromI ? this.children[fromI - 1].dom!.nextSibling : null) || this.dom!.firstChild
    let endDOM = toI < this.children.length - 1 ? this.children[toI + 1].dom : null
    return {from: fromStart, to: toEnd, text: readDOM(startDOM, endDOM)}
  }

  nearest(dom: Node): ViewDesc | null {
    for (let cur: Node | null = dom; cur;) {
      let domView = cur.cmView
      if (domView) {
        for (let v: ViewDesc | null = domView; v; v = v.parent)
          if (v == this) return domView
      }
      cur = cur.parentNode
    }
    return null
  }

  posFromDOM(node: Node, offset: number): number {
    let desc = this.nearest(node)
    if (!desc) throw new RangeError("Trying to find position for a DOM position outside of the document")
    return desc.localPosFromDOM(node, offset) + desc.posAtStart
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = new ChildCursor(this.children, this.text.length, 1).findPos(pos)
    return this.children[i].domFromPos(off)
  }
}

const MAX_JOIN_LEN = 256

class LineViewDesc extends ViewDesc {
  children: LineElementViewDesc[];
  length: number;

  constructor(parent: DocViewDesc, content: LineElementViewDesc[]) {
    super(parent, document.createElement("div"))
    this.length = 0
    this.children = []
    if (content.length) this.update(0, 0, content)
  }

  update(from: number, to: number = this.length, content: LineElementViewDesc[]) {
    this.markDirty()
    let cur = new ChildCursor(this.children, this.length)
    let {i: toI, off: toOff} = cur.findPos(to, 1)
    let {i: fromI, off: fromOff} = cur.findPos(from, -1)
    let dLen = from - to
    for (let i = 0; i < content.length; i++) dLen += content[i].length
    this.length += dLen

    // Both from and to point into the same text view
    if (fromI == toI && fromOff) {
      let start = this.children[fromI] as TextViewDesc
      // Maybe just update that view and be done
      if (content.length == 1 && start.merge(content[0], fromOff, toOff)) return
      if (content.length == 0) return start.cut(fromOff, toOff)
      // Otherwise split it, so that we don't have to worry about aliasting front/end afterwards
      appendLineElements(content, [new TextViewDesc(start.text.slice(toOff), start.tagName, start.attrs)])
      toI++
      toOff = 0
    }

    // Make sure start and end positions fall on node boundaries
    // (fromOff/toOff are no longer used after this), and that if the
    // start or end of the content can be merged with adjacent nodes,
    // this is done
    if (toOff) {
      let end = this.children[toI] as TextViewDesc
      if (content.length && end.merge(content[content.length - 1], 0, toOff)) content.pop()
      else end.cut(0, toOff)
    } else if (toI < this.children.length && content.length &&
               this.children[toI].merge(content[content.length - 1], 0, 0)) {
      content.pop()
    }
    if (fromOff) {
      let start = this.children[fromI] as TextViewDesc
      if (content.length && start.merge(content[0], fromOff)) content.shift()
      else start.cut(fromOff)
      fromI++
    } else if (fromI && content.length && this.children[fromI - 1].merge(content[0], this.children[fromI - 1].length)) {
      content.shift()
    }

    // Then try to merge any mergeable nodes at the start and end of
    // the changed range
    while (fromI < toI && content.length && this.children[toI - 1].merge(content[content.length - 1])) {
      this.children.pop()
      toI--
    }
    while (fromI < toI && content.length && this.children[fromI].merge(content[0])) {
      this.children.shift()
      fromI++
    }

    // And if anything remains, splice the child array to insert the new content
    if (content.length || fromI != toI) {
      for (let i = 0; i < content.length; i++) content[i].finish(this)
      this.children.splice(fromI, toI - fromI, ...content)
      this.markDirty()
    }
  }

  detachTail(from: number): TextViewDesc[] {
    let result: TextViewDesc[] = []
    if (this.length == 0) return result
    let {i, off} = new ChildCursor(this.children, this.length).findPos(from)
    if (off > 0) {
      let child = this.children[i] as TextViewDesc
      result.push(new TextViewDesc(child.text.slice(off), child.tagName, child.attrs))
      child.cut(off)
      i++
    }
    if (i < this.children.length) {
      for (let j = i; j < this.children.length; j++) result.push(this.children[j] as TextViewDesc)
      this.children.length = i
      this.markDirty()
    }
    this.length = from
    return result
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = new ChildCursor(this.children, this.length).findPos(pos)
    while (off == 0 && i > 0 && this.children[i - 1].length == 0) i--
    if (off == 0) return {node: this.dom!, offset: i}
    let child = this.children[i]
    if (child instanceof TextViewDesc) return {node: child.textDOM!, offset: off}
    else return {node: this.dom!, offset: i}
  }

  sync() {
    super.sync()
    let last = this.dom!.lastChild
    if (!last || last.nodeName == "BR") {
      let hack = document.createElement("BR")
      hack.cmIgnore = true
      this.dom.appendChild(hack)
    }
  }
}

const noChildren: ViewDesc[] = []

abstract class LineElementViewDesc extends ViewDesc {
  merge(other: LineElementViewDesc, from: number = 0, to: number = 0): boolean { return false }
  get children() { return noChildren }
  finish(parent: ViewDesc) {}
}

function appendLineElements(a: LineElementViewDesc[], b: LineElementViewDesc[]): LineElementViewDesc[] {
  let i = 0
  if (b.length && a.length && a[a.length - 1].merge(b[0])) i++
  for (; i < b.length; i++) a.push(b[i])
  return a
}

class TextViewDesc extends LineElementViewDesc {
  textDOM: Node | null = null;

  constructor(public text: string, public tagName: string | null, public attrs: {[key: string]: string} | null) {
    super(null, null)
  }

  finish(parent: ViewDesc) {
    this.parent = parent
    if (this.dom) return
    this.textDOM = document.createTextNode(this.text)
    let tagName = this.tagName || (this.attrs ? "span" : null)
    if (tagName) {
      this.dom = document.createElement(tagName)
      this.dom.appendChild(this.textDOM)
      if (this.attrs) for (let name in this.attrs) (this.dom as Element).setAttribute(name, this.attrs[name])
    } else {
      this.dom = this.textDOM
    }
    this.dom.cmView = this
  }

  get length() { return this.text.length }

  sync() {
    if (this.dirty & NODE_DIRTY) {
      if (this.textDOM!.nodeValue != this.text) this.textDOM!.nodeValue = this.text
      let dom = this.dom!
      if (this.textDOM != dom && (this.dom!.firstChild != this.textDOM || dom.lastChild != this.textDOM)) {
        while (dom.firstChild) dom.removeChild(dom.firstChild)
        dom.appendChild(this.textDOM!)
      }
    }
    this.dirty = NOT_DIRTY
  }

  merge(other: LineElementViewDesc, from: number = 0, to: number = this.length): boolean {
    if (!(other instanceof TextViewDesc) || other.tagName != this.tagName ||
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
}

class WidgetViewDesc extends LineElementViewDesc {
  constructor(readonly widget: Widget<any>, readonly side: number) {
    super(null, null)
  }

  finish(parent: ViewDesc) {
    this.parent = parent
    if (!this.dom) {
      this.dom = this.widget.toDOM()
      this.dom.cmView = this
    }
  }  

  get length() { return 0 }
  get ignoreDOMText() { return true }

  merge(other: LineElementViewDesc): boolean {
    return other instanceof WidgetViewDesc &&
      (other.widget == this.widget || other.widget.constructor == this.widget.constructor && other.widget.eq(this.widget)) &&
      other.side == this.side
  }
}

class LineElementBuilder {
  lineI: number = 0;
  stringI: number = 0;
  stringOff: number = 0;
  elements: LineElementViewDesc[][] = [[]];
  active: RangeDesc[] = [];

  constructor(readonly lines: string[][], public pos: number) {}

  advance(pos: number) {
    if (pos <= this.pos) return

    let tagName = null
    let attrs: {[key: string]: string} | null = null
    for (let i = 0; i < this.active.length; i++) {
      let spec = this.active[i].spec
      if (spec.tagName) tagName = spec.tagName
      if (spec.attributes) for (let name in spec.attributes) {
        let value = spec.attributes[name]
        if (value == null) continue
        if (!attrs) attrs = {}
        if (name == "style" && attrs.style)
          value = attrs.style + ";" + value
        else if (name == "class" && attrs.class)
          value = attrs.class + " " + value
        attrs[name] = value
      }
    }

    for (let len = pos - this.pos;;) {
      let line = this.lines[this.lineI]
      if (this.stringI == line.length) {
        // End of line, add a line break placeholder
        // FIXME maybe gather line decorations here
        this.elements.push([])
        this.lineI++
        this.stringI = this.stringOff = 0
        if (--len == 0) break
        continue
      }

      let string = line[this.stringI]
      let cut = Math.min(len, string.length - this.stringOff)
      if (cut > 0) {
        this.elements[this.elements.length - 1].push(
          new TextViewDesc(string.slice(this.stringOff, this.stringOff + cut), tagName, attrs))
        this.stringOff += cut
        len -= cut
        if (len == 0) break
      }

      // Moving past the end of the current string
      // FIXME join small compatible ranges together
      this.stringOff = 0
      this.stringI++
    }

    this.pos = pos
  }

  addWidget(widget: Widget<any>, side: number) {
    this.elements[this.elements.length - 1].push(new WidgetViewDesc(widget, side))
  }
}

function readDOM(start: Node | null, end: Node | null): string {
  let text = "", cur = start
  if (cur) for (;;) {
    text += readDOMNode(cur!)
    let next: Node | null = cur!.nextSibling
    if (next == end) break
    if (isBlockNode(cur!)) text += "\n"
    cur = next
  }
  return text
}

function readDOMNode(node: Node): string {
  // FIXME add a way to ignore certain nodes based on their desc
  if (node.cmIgnore) return ""
  let desc = node.cmView
  if (desc && desc.ignoreDOMText) return ""
  if (node.nodeType == 3) return node.nodeValue as string
  if (node.nodeName == "BR") return node.nextSibling ? "\n" : ""
  if (node.nodeType == 1) return readDOM(node.firstChild, null)
  return ""
}

function isBlockNode(node: Node): boolean {
  return node.nodeType == 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|DD|DT|H\d|SECTION|PRE)$/.test(node.nodeName)
}

class ChildCursor {
  i: number;
  off: number = 0;

  constructor(public children: ViewDesc[], public pos: number, public gap: number = 0) {
    this.i = children.length
    this.pos += gap
  }

  findPos(pos: number, bias: number = 1): this {
    for (;;) {
      if (pos > this.pos || pos == this.pos && (bias > 0 || this.i == 0)) {
        this.off = pos - this.pos
        return this
      }
      this.pos -= this.children[--this.i].length + this.gap
    }
  }
}

function linesBetween(text: Text, start: number, end: number): string[][] {
  let result: string[][] = [[]]
  if (start == end) return result
  for (let textCur = text.iterRange(start, end);;) {
    let value = textCur.next()
    if (value.length == 0) return result
    for (let pos = 0;;) {
      let nextNewline = value.indexOf("\n", pos)
      if (nextNewline == -1) {
        if (pos < value.length) result[result.length - 1].push(value.slice(pos))
        break
      } else {
        if (nextNewline > pos) result[result.length - 1].push(value.slice(pos, nextNewline))
        result.push([])
        pos = nextNewline + 1
      }
    }
  }
}

function findPluginDeco(decorations: ReadonlyArray<PluginDeco>, plugin: Plugin | null): DecorationSet | null {
  for (let i = 0; i < decorations.length; i++)
    if (decorations[i].plugin == plugin) return decorations[i].decorations
  return null
}

function extendForChangedDecorations(diff: ReadonlyArray<ChangedRange>,
                                     decorations: ReadonlyArray<PluginDeco>,
                                     oldDecorations: ReadonlyArray<PluginDeco>): ReadonlyArray<ChangedRange> {
  let ranges: number[] = []
  for (let i = 0; i < decorations.length; i++) {
    let deco = decorations[i]
    let newRanges = (findPluginDeco(oldDecorations, deco.plugin) || DecorationSet.empty)
      .changedRanges(deco.decorations, diff)
    ranges = joinRanges(ranges, newRanges)
  }
  for (let i = 0; i < oldDecorations.length; i++) {
    let old = oldDecorations[i]
    if (!findPluginDeco(decorations, old.plugin))
      ranges = joinRanges(ranges, old.decorations.changedRanges(DecorationSet.empty, diff))
  }
  return extendWithRanges(diff, ranges)
}

function addChangedRange(ranges: ChangedRange[], fromA: number, toA: number, fromB: number, toB: number) {
  if (ranges.length) {
    let last = ranges[ranges.length - 1]
    if (last.toA == fromA && last.toB == fromB) {
      ranges[ranges.length - 1] = new ChangedRange(last.fromA, toA, last.fromB, toB)
      return
    }
  }
  ranges.push(new ChangedRange(fromA, toA, fromB, toB))
}

function extendWithRanges(diff: ReadonlyArray<ChangedRange>, ranges: number[]): ReadonlyArray<ChangedRange> {
  let result: ChangedRange[] = []
  for (let dI = 0, rI = 0, posA = 0, posB = 0;; dI++) {
    let next = dI == diff.length ? null : diff[dI], off = posA - posB
    let end = next ? next.fromB : 2e9
    while (rI < ranges.length && ranges[rI] < end) {
      let from = ranges[rI++], to = ranges[rI++]
      addChangedRange(result, from + off, to + off, from, to)
    }
    if (!next) return result
    addChangedRange(result, next.fromA, next.toA, next.fromB, next.toB)
    posA = next.toA; posB = next.toB
  }
}
