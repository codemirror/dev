import {Text} from "../../doc/src/text"

/*

DISCLAIMER

The current content of this file is all wrong and not the right
approach at all, but since I couldn't figure out how to do this
properly yet I did this wrong stuff so that we can start getting
something to work and as a way to gather some experience about what
the right solution might look like.

*/

declare global {
  interface Node { cmView: ViewDesc | undefined }
}

interface Range { from: number, to: number }

export abstract class ViewDesc {
  constructor(public parent: ViewDesc | null, public dom: Node) {}

  abstract children: ViewDesc[];
  abstract length: number;

  get childGap() { return 0 }

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

  syncDOM() {
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

  syncDOMFor(ranges: Range[]) {
    if (ranges.length == 0) return
    let syncTop = false, rangeI = 0, nextRange = ranges[0]
    outer: for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length, childRanges: Range[] | null = null
      while (nextRange.from < end) {
        if (!childRanges) childRanges = []
        childRanges.push({from: Math.max(0, nextRange.from - pos),
                          to: Math.min(child.length, nextRange.to - pos)})
        if (nextRange.to <= end) {
          if (rangeI == ranges.length - 1) {
            child.syncDOMFor(childRanges)
            break outer
          }
          nextRange = ranges[++rangeI]
        } else {
          syncTop = true
          break
        }
      }
      if (childRanges) child.syncDOMFor(childRanges)
      pos = end + this.childGap
      if (nextRange.to == pos) {
        syncTop = true
        if (rangeI == ranges.length - 1) break
        nextRange = ranges[++rangeI]
      }
    }
    if (syncTop) this.syncDOM()
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

  domFromPos(pos: number): {node: Node, offset: number} {
    for (let offset = 0, i = 0; i < this.children.length; i++) {
      let child = this.children[i], end = offset + child.length
      if (pos <= end) return child.domFromPos(pos - offset)
      offset = end + this.childGap
    }
    return {node: this.dom, offset: this.dom.childNodes.length}
  }
}

// Remove a DOM node and return its next sibling.
function rm(dom: Node): Node {
  let next = dom.nextSibling
  dom.parentNode!.removeChild(dom)
  return next!
}

export class DocViewDesc extends ViewDesc {
  lines: LineViewDesc[];
  dirtyRanges: Range[] = [];

  get children() { return this.lines }
  get length() { return this.text.length }
  get childGap() { return 1 }

  constructor(public text: Text, dom: Element) {
    super(null, dom)
    let curLine = new LineViewDesc()
    curLine.parent = this
    dom.cmView = this
    this.lines = [curLine]
    this.text = Text.create("")
    this.update(text)
  }

  update(text: Text) {
    let prevText = this.text
    let plan = buildUpdatePlan(prevText, text)
    this.text = text
    if (plan.length == 0) return

    for (let planI = plan.length - 1, range = plan[planI], lineI = this.lines.length - 1, pos = prevText.length;;) {
      let line = this.lines[lineI], start = pos - line.length
      if (start > range.prevEnd) {
        // No change for this line
        if (lineI == 0) break
        lineI--
        pos = start - 1
      } else {
        let startI = lineI, endOffset = range.prevEnd - start
        while (start > range.prevStart) start -= this.lines[--startI].length
        lineI = startI
        this.updateRange(startI, range.prevStart - start, lineI, endOffset, text, range.curStart, range.curEnd)
        if (planI == 0) { this.lines[lineI].syncDOM(); break }
        pos = start + this.lines[startI].length
        range = plan[--planI]
      }
    }

    this.syncDOMFor(finalDirtyRanges(this.dirtyRanges, plan))
    this.dirtyRanges.length = 0
  }

  updateRange(fromI: number, fromOff: number, toI: number, toOff: number,
              text: Text, from: number, to: number) {
    let fromLine = this.lines[fromI], tail = null

    // First remove the deleted range
    // FIXME make line DOM changes a single step for within-line changes
    if (fromI != toI) { // Across lines
      fromLine.removeRange(fromOff, fromLine.length)
      tail = this.lines[toI].detachTail(toOff)
      if (fromI + 1 < toI) this.lines.splice(fromI + 1, toI - fromI - 1)
    } else if (fromOff != toOff) {
      fromLine.removeRange(fromOff, toOff)
    }

    // Then insert the added range, if any
    let curLine = fromLine, lineI = fromI
    if (from < to) {
      for (let iter = text.iterRange(from, to), next, linePos = fromOff; !(next = iter.next()).done;) {
        for (let start = 0;;) {
          let end = next.value.indexOf("\n", start)
          let text = next.value.slice(start, end == -1 ? undefined : end)
          if (text) {
            curLine.insertText(linePos, text)
            linePos += text.length
          }
          if (end == -1) break
          if (!tail) tail = curLine.detachTail(linePos)
          if (curLine != fromLine) curLine.syncDOM()
          this.lines.splice(++lineI, 0, curLine = new LineViewDesc())
          curLine.parent = this
          linePos = 0
          start = end + 1
        }
      }
      if (curLine != fromLine) curLine.syncDOM()
    }

    if (tail) {
      // Need to join lines
      for (let i = 0; i < tail.length; i++) curLine.add(tail[i])
    }
  }

  readDOMRange(from: number, to: number): {from: number, to: number, text: string} {
    // FIXME partially parse lines when possible
    let fromI = -1, fromStart = -1, toI = -1, toEnd = -1
    if (this.lines.length == 0) return {from: 0, to: 0, text: readDOMContent(this.dom)}
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      /*      if (pos < from && end > to) {
        let result = child.parseRange(from - pos, to - pos)
        return {from: result.from + pos, to: result.to + pos, text: result.text}
      }*/
      if (pos <= from && fromI == -1) { fromI = i; fromStart = pos }
      if (end >= to && toI == -1) { toI = i; toEnd = end; break }
      pos = end + 1
    }
    let text = "", fromDesc = this.children[fromI], toDesc = this.children[toI]
    let startDOM = fromDesc.dom.parentNode == this.dom ? fromDesc.dom
      : (fromI ? this.children[fromI - 1].dom.nextSibling : null) || this.dom.firstChild
    let endDOM = toDesc.dom.parentNode == this.dom ? toDesc.dom.nextSibling
      : toI < this.children.length - 1 ? this.children[toI + 1].dom : null
    for (let cur = startDOM; cur != endDOM; cur = cur!.nextSibling) {
      if (cur != startDOM) text += "\n"
      text += readDOM(cur!)
    }
    return {from: fromStart, to: toEnd, text}
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
}

class LineViewDesc extends ViewDesc {
  children: TextViewDesc[];
  length: number;

  constructor() {
    super(null, document.createElement("div"))
    this.dom.cmView = this
    this.children = []
    this.length = 0
  }

  add(child: TextViewDesc) {
    this.children.push(child)
    child.parent = this
    this.length += child.length
  }

  insertText(at: number, text: string) {
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (at >= pos && at < end) {
        this.length += text.length
        child.insertText(at - pos, text)
        return
      }
      pos = end
    }
    this.add(new TextViewDesc(text))
  }

  removeRange(from: number, to: number) {
    this.length -= to - from
    for (let i = 0, pos = 0; i < this.children.length && pos < to; i++) {
      let child = this.children[i], end = pos + child.length
      if (end > from) {
        if (pos < from || end > to) {
          child.removeRange(Math.max(from - pos, 0), Math.min(to - pos, child.length))
        } else {
          this.children.splice(i--, 1)
        }
      }
      pos = end
    }
  }

  detachTail(from: number): TextViewDesc[] {
    this.length = from
    let endIndex = -1, result = []
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (end > from) {
        if (pos < from) {
          endIndex = i + 1
          result.push(new TextViewDesc(child.text.slice(from - pos)))
          child.removeRange(from - pos, child.length)
        } else {
          if (endIndex < 0) endIndex = i
          result.push(child)
        }
      }
      pos = end
    }
    if (endIndex > -1) this.children.length = endIndex
    return result
  }
}

const noChildren: ViewDesc[] = []

class TextViewDesc extends ViewDesc {
  constructor(public text: string) {
    super(null, document.createTextNode(text))
    this.dom.cmView = this
  }

  get children() { return noChildren }
  get length() { return this.text.length }

  removeRange(from: number, to: number) {
    this.text = this.text.slice(0, from) + this.text.slice(to)
    this.dom.nodeValue = this.text
  }

  insertText(at: number, text: string) {
    this.text = this.text.slice(0, at) + text + this.text.slice(at)
    this.dom.nodeValue = this.text
  }

  syncDOM() {
    if (this.dom.nodeValue != this.text)
      this.dom.nodeValue = this.text
  }

  syncDOMFor(_ranges: Range[]) { this.syncDOM() }

  localPosFromDOM(_node: Node, offset: number): number {
    return offset
  }

  domFromPos(pos: number): {node: Node, offset: number} {
    return {node: this.dom, offset: pos}
  }
}

interface UpdateRange {
  prevStart: number, curStart: number, prevEnd: number, curEnd: number
}

// FIXME more intelligent diffing
function buildUpdatePlan(prev: Text, current: Text): UpdateRange[] {
  let plan: UpdateRange[] = []

  function scanChildren(startOff: number, prev: Text, current: Text) {
    let chPrev = prev.children, chCur= current.children
    if (chPrev == null || chCur == null) {
      scanText(startOff, prev.text, current.text) // FIXME may concatenate a huge string (scanText should iterate nodes)
      return
    }
    let minLen = Math.min(chPrev.length, chCur.length)
    let start = 0, skipOff = startOff, end  = 0
    while (start < minLen && chPrev[start] != chCur[start]) { start++; skipOff += chPrev[start].length + 1 }
    while (end < minLen - start &&
           chPrev[chPrev.length - 1 - end] == chCur[chCur.length - 1 - end]) end++
    if (chPrev.length == chCur.length && start + end + 1 >= minLen) {
      if (start + end != minLen)
        scanChildren(skipOff, chPrev[start], chCur[start])
    } else {
      let prevText = "", curText = ""
      for (let i = start; i < chPrev.length - end; i++) prevText += chPrev[i].text
      for (let i = start; i < chCur.length - end; i++) curText += chCur[i].text
      scanText(skipOff, prevText, curText)
    }
  }

  function scanText(startOff: number, prev: string, current: string) {
    let start = 0, end = 0, minLen = Math.min(prev.length, current.length)
    while (start < minLen && prev.charCodeAt(start) == current.charCodeAt(start)) start++
    if (start == minLen && prev.length == current.length) return
    while (end < minLen- start &&
           prev.charCodeAt(prev.length - 1 - end) == current.charCodeAt(current.length - 1 - end)) end++
    plan.push({prevStart: startOff + start, curStart: startOff + start,
               prevEnd: startOff + prev.length - end, curEnd: startOff + current.length - end})
  }

  scanChildren(0, prev, current)
  return plan
}

function readDOM(node: Node): string {
  // FIXME add a way to ignore certain nodes based on their desc
  if (node.nodeType == 3) return node.nodeValue as string
  else if (node.nodeType == 1) return readDOMContent(node)
  else return ""
}

function readDOMContent(node: Node) {
  let text = ""
  for (let child = node.firstChild; child; child = child.nextSibling) text += readDOM(child)
  return text
}

function mapThroughPlan(pos: number, plan: UpdateRange[]) {
  let offset = 0
  for (let i = 0; i < plan.length; i++) {
    let range = plan[i]
    if (range.prevStart >= pos) break
    if (range.prevEnd > pos) return range.curStart
    offset += (range.curEnd - range.curStart) - (range.prevEnd - range.prevStart)
  }
  return pos + offset
}

function addRange(ranges: Range[], from: number, to: number) {
  if (from >= to) return
  let i = 0;
  for (; i < ranges.length; i++) {
    let range = ranges[i]
    if (range.from > to) break
    if (range.to < from) continue
    range.from = Math.min(from, range.from)
    range.to = Math.max(to, range.to)
    while (i < ranges.length - 1 && range.to > ranges[i + 1].from) {
      range.to = Math.max(ranges[i + 1].to, range.to)
      ranges.splice(i + 1, 1)
    }
    return
  }
  ranges.splice(i, 0, {from, to})
}

function finalDirtyRanges(dirtyRanges: Range[], plan: UpdateRange[]): Range[] {
  let ranges = plan.map(r => ({from: r.curStart, to: r.curEnd}))
  for (let i = 0; i < dirtyRanges.length; i++) {
    let dRange = dirtyRanges[i]
    addRange(ranges, mapThroughPlan(dRange.from, plan), mapThroughPlan(dRange.to, plan))
  }
  return ranges
}
