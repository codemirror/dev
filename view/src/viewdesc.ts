import {Text} from "../../doc/src/text"
import {changedRanges, ChangedRange} from "../../doc/src/diff"
import {Plugin} from "../../state/src/state"
import {DecorationSet, DecoratedSpan, joinRanges, attrsEq} from "./decoration"

declare global {
  interface Node { cmView: ViewDesc | undefined }
}

const NOT_DIRTY = 0, CHILD_DIRTY = 1, NODE_DIRTY = 2

export abstract class ViewDesc {
  constructor(public parent: ViewDesc | null, public dom: Node) {
    dom.cmView = this
  }

  abstract length: number;
  abstract children: ViewDesc[];
  dirty: number = NOT_DIRTY;

  get childGap() { return 0 }
  get ignoreInDOM() { return false }

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
    let dom = this.dom.firstChild
    for (let i = 0; i < this.children.length; i++) {
      let desc = this.children[i], childDOM = desc.dom
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
    this.dirty |= NODE_DIRTY
    for (let parent = this.parent; parent; parent = parent.parent)
      parent.dirty |= CHILD_DIRTY
  }

  canJoinWithSpan(span: DecoratedSpan, overlap: number): boolean { return false }
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
      let lines = DecoratedSpan.build(decorations.map(d => d.decorations), fromB, toB,
                                      linesBetween(text, fromB, toB))

      if (lines.length == 1) {
        if (fromI == toI) { // Change within single line
          this.children[fromI].update(fromOff, toOff, lines[0])
          this.dirty |= CHILD_DIRTY
        } else { // Join lines
          let tail = this.children[toI].detachTail(toOff)
          this.children[fromI].update(fromOff, undefined, lines[0], tail)
          this.children.splice(fromI + 1, toI - fromI)
          this.dirty |= CHILD_DIRTY | NODE_DIRTY
        }
      } else { // Across lines
        let tail = this.children[toI].detachTail(toOff)
        this.children[fromI].update(fromOff, undefined, lines[0])
        let insert = []
        for (let j = 1; j < lines.length; j++)
          insert.push(new LineViewDesc(this, lines[j], j == lines.length - 1 ? tail : undefined))
        this.children.splice(fromI + 1, toI - fromI, ...insert)
        this.dirty |= CHILD_DIRTY | NODE_DIRTY
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
    let startDOM = (fromI ? this.children[fromI - 1].dom.nextSibling : null) || this.dom.firstChild
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
  children: ViewDesc[];
  length: number;

  constructor(parent: DocViewDesc, content: DecoratedSpan[], tail: TextViewDesc[] | null = null) {
    super(parent, document.createElement("div"))
    this.length = 0
    this.children = []
    this.update(0, 0, content, tail)
  }

  update(from: number, to: number = this.length, content: DecoratedSpan[], tail: TextViewDesc[] | null = null) {
    if (this.children.length == 1 && this.children[this.children.length - 1] instanceof EmptyLineHack) {
      this.children.pop()
      this.dirty |= NODE_DIRTY
    }

    let children = this.children as TextViewDesc[]
    let cur = new ChildCursor(children, this.length)
    let totalLen = 0
    for (let j = 0; j < content.length; j++) totalLen += content[j].text.length
    let dLen = totalLen - (to - from)

    let {i: toI, off: toOff} = cur.findPos(to)
    let {i: fromI, off: fromOff} = cur.findPos(from)

    if (from == 0 && to == this.length && content.length == 0) {
      this.children.length = 0
      this.dirty |= NODE_DIRTY
    } else if (fromI < children.length &&
        (toI == fromI || toI == fromI + 1 && toOff == 0) &&
        (content.length == 0 || content.length == 1 && children[fromI].canJoinWithSpan(content[0], to - from))) {
      children[fromI].update(fromOff, toI == fromI ? toOff : undefined, content.length ? content[0].text : "")
      this.dirty |= CHILD_DIRTY
    } else {
      if (content.length > 0 && fromOff > 0 &&
          children[fromI].canJoinWithSpan(content[0], children[fromI].text.length - fromOff)) {
        content[0] = new DecoratedSpan(children[fromI].text.slice(0, fromOff) + content[0].text,
                                       content[0].tagName, content[0].attrs)
        fromOff = 0
      } else if (content.length > 0 && fromOff == 0 && fromI > 0 &&
                 children[fromI - 1].canJoinWithSpan(content[0], 0)) {
        if (fromI == toI && toOff == 0) {
          children[fromI - 1].update(children[fromI - 1].length, undefined, content[0].text)
          this.dirty |= CHILD_DIRTY
          content.shift()
        } else {
          content[0] = new DecoratedSpan(children[fromI - 1].text + content[0].text, content[0].tagName, content[0].attrs)
          fromI--
        }
      } else if (fromOff > 0) {
        children[fromI].update(fromOff)
        this.dirty |= CHILD_DIRTY
        fromI++
      }
      if (content.length && toI < children.length &&
          children[toI].canJoinWithSpan(content[content.length - 1], toOff)) {
        let last = content[content.length - 1]
        content[content.length - 1] = new DecoratedSpan(last.text + children[toI].text.slice(toOff), last.tagName, last.attrs)
        toI++
      } else if (toOff > 0) {
        children[toI].update(0, toOff)
        this.dirty |= CHILD_DIRTY
      }

      if (toI > fromI || content.length) {
        children.splice(fromI, toI - fromI, ...content.map(s => new TextViewDesc(this, s.text, s.tagName, s.attrs)))
        this.dirty |= NODE_DIRTY | CHILD_DIRTY
      }
    }
    this.length += dLen

    if (tail) this.attachTail(tail)

    if (this.length == 0) {
      this.children.push(new EmptyLineHack(this))
      this.dirty |= NODE_DIRTY
    }
  }

  attachTail(tail: TextViewDesc[]) {
    for (let i = 0; i < tail.length; i++) {
      let child = tail[i]
      child.parent = this
      this.children.push(child)
      this.length += child.length
    }
    this.dirty |= NODE_DIRTY | CHILD_DIRTY
  }

  detachTail(from: number): TextViewDesc[] {
    let result: TextViewDesc[] = []
    if (this.length == 0) return result
    let {i, off} = new ChildCursor(this.children, this.length).findPos(from)
    if (off > 0) {
      let child = this.children[i] as TextViewDesc
      result.push(new TextViewDesc(this, child.text.slice(off), child.tagName, child.attrs))
      child.update(off)
      this.dirty |= CHILD_DIRTY
      i++
    }
    if (i < this.children.length) {
      for (let j = i; j < this.children.length; j++) result.push(this.children[j] as TextViewDesc)
      this.children.length = i
      this.dirty |= NODE_DIRTY
    }
    this.length = from
    return result
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    let {i, off} = new ChildCursor(this.children, this.length).findPos(pos)
    while (off == 0 && i > 0 && this.children[i - 1].length == 0) i--
    if (off == 0) return {node: this.dom, offset: i}
    let child = this.children[i]
    if (child instanceof TextViewDesc) return {node: child.textDOM, offset: off}
    else return {node: this.dom, offset: i}
  }
}

const noChildren: ViewDesc[] = []

function buildDOM(text: string, tagName: string | null, attrs: {[key: string]: string} | null): Node {
  let textNode = document.createTextNode(text)
  if (attrs && !tagName) tagName = "span"
  else if (!tagName) return textNode
  let node = document.createElement(tagName)
  node.appendChild(textNode)
  if (attrs) for (let name in attrs) node.setAttribute(name, attrs[name])
  return node
}

class TextViewDesc extends ViewDesc {
  textDOM: Node;

  constructor(parent: LineViewDesc, public text: string,
              public tagName: string | null, public attrs: {[key: string]: string} | null) {
    super(parent, buildDOM(text, tagName, attrs))
    this.textDOM = tagName || attrs ? this.dom.firstChild! : this.dom
  }

  get children() { return noChildren }
  get length() { return this.text.length }

  update(from: number, to: number = this.text.length, content: string = "") {
    this.text = this.text.slice(0, from) + content + this.text.slice(to)
    this.dirty |= NODE_DIRTY
  }

  sync() {
    if (this.dirty & NODE_DIRTY) {
      if (this.textDOM.nodeValue != this.text) this.textDOM.nodeValue = this.text
      if (this.textDOM != this.dom && (this.dom.firstChild != this.textDOM || this.dom.lastChild != this.textDOM)) {
        while (this.dom.firstChild) this.dom.removeChild(this.dom.firstChild)
        this.dom.appendChild(this.textDOM)
      }
    }
    this.dirty = NOT_DIRTY
  }

  localPosFromDOM(node: Node, offset: number): number {
    return node == this.textDOM ? offset : offset ? this.text.length : 0
  }

  canJoinWithSpan(span: DecoratedSpan, overlap: number): boolean {
    return span.text.length + this.text.length - overlap <= MAX_JOIN_LEN &&
      this.tagName == span.tagName && attrsEq(this.attrs, span.attrs)
  }
}

class EmptyLineHack extends ViewDesc {
  get length() { return 0 }
  get children() { return noChildren }
  get ignoreInDOM() { return true }
  constructor(parent: ViewDesc) {
    super(parent, document.createElement("br"))
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
  let desc = node.cmView
  if (desc && desc.ignoreInDOM) return ""
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

  findPos(pos: number): this {
    for (;;) {
      if (pos >= this.pos) {
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
