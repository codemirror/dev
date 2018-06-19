import {Text, TextCursor} from "../../doc/src/text"
import {ChangedRange} from "../../doc/src/diff"
import {DecorationSet, buildLineElements, RangeDesc, WidgetType} from "./decoration"

export class HeightOracle {
  doc: Text = Text.create("")

  heightForRange(from: number, to: number): number {
    console.log("range is", from, to)
    let lines = this.doc.linePos(to).line - this.doc.linePos(from).line + 1
    return 14 * lines
  }

  heightForLine(length: number): number { return 14 }

  setDoc(doc: Text): this { this.doc = doc; return this }
}

class ReplaceSide {
  // FIXME could compute these lazily, since they are often not needed
  constructor(readonly breakInside: number, readonly nextBreak: number) {}
  static start(doc: Text, start: number, length: number): ReplaceSide {
    let atEnd = doc.linePos(start + length)
    if (atEnd.col >= length) return new ReplaceSide(-1, atEnd.col - length)
    return new ReplaceSide(atEnd.col, doc.linePos(start).col)
  }
  static end(doc: Text, end: number, length: number): ReplaceSide {
    let atEnd = doc.linePos(end), next = doc.lineEnd(atEnd.line) - atEnd.col
    if (atEnd.col >= length) return new ReplaceSide(-1, next)
    let atStart = doc.linePos(end - length)
    return new ReplaceSide(doc.lineEnd(atStart.line) - atStart.col, next)
  }
}

export abstract class HeightMapNode {
  height: number = -1 // Height of this part of the document, or -1 when uninitialized
  abstract size: number
  constructor(
    public length: number // The number of characters covered
  ) {}

  abstract heightAt(pos: number): number
  abstract posAt(height: number): number
  abstract replace(from: number, to: number, nodes: HeightMapNode[],
                   start: ReplaceSide | null, end: ReplaceSide | null): HeightMapNode
  abstract computeHeight(oracle: HeightOracle, offset: number): number
  abstract setMeasuredHeights(from: number, to: number, lines: number[], oracle: HeightOracle, offset: number): HeightMapNode

  applyChanges(doc: Text, decorations: ReadonlyArray<DecorationSet>, changes: ReadonlyArray<ChangedRange>): HeightMapNode {
    let me: HeightMapNode = this
    for (let i = changes.length - 1; i >= 0; i--) {
      let range = changes[i]
      let nodes = buildChangedNodes(doc, decorations, range.fromB, range.toB)
      me = me.replace(range.fromA, range.toA, nodes, ReplaceSide.start(doc, range.fromB, nodes[0].length),
                      ReplaceSide.end(doc, range.toB, nodes[nodes.length - 1].length))
    }
    return me
  }

  static empty() { return new HeightMapRange(0) }
}

const noDeco: number[] = []

class HeightMapLine extends HeightMapNode {
  constructor(length: number, public deco: number[] = noDeco) { super(length) }

  get size(): number { return 1 }

  // FIXME try to estimate wrapping? Or are height queries always per-line?
  heightAt(pos: number): number { return 0 }
  posAt(height: number): number { return 0 }

  copy() { return new HeightMapLine(this.length, this.deco) }

  replace(from: number, to: number, nodes: HeightMapNode[], start: ReplaceSide | null, end: ReplaceSide | null): HeightMapNode {
    if (end) {
      let last = (nodes.length == 1 ? this : this.copy()).replaceStart(to, nodes[nodes.length - 1], end)
      if (last instanceof HeightMapBranch) nodes.splice(nodes.length - 1, 1, last.left, last.right)
      else nodes[nodes.length - 1] = last
    }
    if (start) nodes[0] = this.replaceEnd(from, nodes[0], start)
    return HeightMapBranch.from(nodes)
  }

  replaceEnd(from: number, node: HeightMapNode, start: ReplaceSide): HeightMapNode {
    this.height = -1
    if (node instanceof HeightMapLine) return this.joinLine(from, this.length, node)
    this.offsetDeco(from, this.length, 0)
    let addLen = start.breakInside == -1 ? node.length : start.breakInside
    this.length = from + addLen
    if (start.breakInside < 0) return this
    return new HeightMapBranch(this, new HeightMapRange(node.length - start.breakInside - 1))
  }

  replaceStart(to: number, node: HeightMapNode, end: ReplaceSide): HeightMapNode {
    this.height = -1
    if (node instanceof HeightMapLine) return this.joinLine(0, to, node)
    let addLen = end.breakInside == -1 ? node.length : end.breakInside
    this.offsetDeco(0, to, addLen)
    this.length += addLen - to
    if (end.breakInside < 0) return this
    return new HeightMapBranch(new HeightMapRange(node.length - end.breakInside - 1), this)
  }

  joinLine(from: number, to: number, node: HeightMapLine): HeightMapNode {
    this.offsetDeco(from, to, node.length)
    for (let i = 0; i < node.deco.length; i += 2) this.addDeco(node.deco[i] + from, node.deco[i + 1])
    this.length += node.length - (to - from)
    return this
  }

  offsetDeco(from: number, to: number, length: number) {
    let off = length - (to - from)
    for (let i = 0; i < this.deco.length; i += 2) {
      let pos = this.deco[i]
      if (pos < from) continue
      if (pos <= to) {
        this.deco.splice(i, 2, 0)
        i -= 2
      } else {
        this.deco[i] += off
      }
    }
  }

  addDeco(pos: number, value: number) {
    if (this.deco == noDeco) this.deco = []
    let i = this.deco.length - 2
    while (i > 0 && this.deco[i] > pos) i -= 2
    this.deco.splice(i, 0, pos, value)
  }

  computeHeight(oracle: HeightOracle, offset: number): number {
    if (this.height > -1) return this.height
    let len = this.length, minH = 0
    for (let i = 1; i < this.deco.length; i += 2) {
      let val = this.deco[i]
      if (val < 0) len += val
      else minH = Math.max(val, minH)
    }
    return this.height = Math.max(oracle.heightForLine(len), minH)
  }

  setMeasuredHeights(from: number, to: number, lines: number[], oracle: HeightOracle, offset: number): HeightMapNode {
    this.height = lines[1]
    return this
  }
}

class HeightMapRange extends HeightMapNode {
  get size(): number { return 1 }

  heightAt(pos: number) {
    return this.height * (pos / this.length)
  }

  posAt(height: number) { // FIXME is this even meaningful?
    return Math.floor(this.length * (height / this.height))
  }

  replace(from: number, to: number, nodes: HeightMapNode[], start: ReplaceSide | null, end: ReplaceSide | null): HeightMapNode {
    if (end) {
      let last = (nodes.length == 1 ? this : new HeightMapRange(this.length)).replaceStart(to, nodes[nodes.length - 1], end)
      if (last instanceof HeightMapBranch) nodes.splice(nodes.length - 1, 1, last.left, last.right)
      else nodes[nodes.length - 1] = last
    }
    if (start) nodes[0] = this.replaceEnd(from, nodes[0], start)
    return HeightMapBranch.from(nodes)
  }

  replaceEnd(from: number, node: HeightMapNode, start: ReplaceSide): HeightMapNode {
    this.height = -1
    if (node instanceof HeightMapRange) {
      this.length = from + node.length
      return this
    }
    if (start.nextBreak > 0) {
      ;(node as HeightMapLine).offsetDeco(0, 0, start.nextBreak)
      node.length += start.nextBreak
      if (start.nextBreak == this.length) return node
    }
    this.length -= start.nextBreak
    return new HeightMapBranch(this, node)
  }

  replaceStart(to: number, node: HeightMapNode, end: ReplaceSide): HeightMapNode {
    this.height = -1
    if (node instanceof HeightMapRange) {
      this.length = this.length - to + node.length
      return this
    }
    if (end.nextBreak > 0) {
      node.length += end.nextBreak
      if (end.nextBreak == this.length) return node
    }
    this.length -= end.nextBreak
    return new HeightMapBranch(node, this)
  }

  computeHeight(oracle: HeightOracle, offset: number): number {
    return this.height > -1 ? this.height : this.height = oracle.heightForRange(offset, offset + this.length)
  }

  setMeasuredHeights(from: number, to: number, lines: number[], oracle: HeightOracle, offset: number): HeightMapNode {
    let nodes = []
    if (from > 0) {
      nodes.push(new HeightMapRange(from - 1))
      nodes[0].computeHeight(oracle, offset)
    }
    for (let i = 0; i < lines.length; i += 2) {
      let line = new HeightMapLine(lines[i])
      line.height = lines[i + 1]
      nodes.push(line)
    }
    if (to < this.length) {
      nodes.push(new HeightMapRange(this.length - to - 1))
      nodes[nodes.length - 1].computeHeight(oracle, to)
    }
    return HeightMapBranch.from(nodes)
  }
}

class HeightMapBranch extends HeightMapNode {
  size: number

  constructor(public left: HeightMapNode, public right: HeightMapNode) {
    super(left.length + 1 + right.length)
    this.size = left.size + right.size
    if (left.height > -1 && right.height > -1) this.height = left.height + right.height
  }

  heightAt(pos: number): number {
    let leftLen = this.left.length
    return pos <= leftLen ? this.left.heightAt(pos) : this.right.heightAt(pos - leftLen - 1)
  }

  posAt(height: number): number {
    if (height <= 0) return 0
    if (height >= this.height) return this.length
    let pastLeft = height - this.left.height
    return pastLeft > 0 ? this.right.posAt(pastLeft) : this.left.posAt(height)
  }

  replace(from: number, to: number, nodes: HeightMapNode[], start: ReplaceSide | null, end: ReplaceSide | null): HeightMapNode {
    let rightStart = this.left.length + 1
    if (to < rightStart) {
      return this.update(this.left.replace(from, to, nodes, start, end), this.right)
    } else if (from >= rightStart) {
      return this.update(this.left, this.right.replace(from - rightStart, to - rightStart, nodes, start, end))
    } else if (nodes.length == 1 && start && end) {
      return this.merge(this.left, from, this.right, to - rightStart, nodes, start, end)
    } else {
      let dSize = this.left.size - this.right.size
      let cut = Math.max(1, Math.min(nodes.length - 1, (nodes.length >> 1) + dSize))
      let right = this.right.replace(0, to - rightStart, nodes.slice(cut), null, end)
      nodes.length = cut
      return this.update(this.left.replace(from, this.left.length, nodes, start, null), right)
    }
  }

  merge(left: HeightMapNode, from: number, right: HeightMapNode, to: number,
        nodes: HeightMapNode[], start: ReplaceSide, end: ReplaceSide): HeightMapNode {
    if (left instanceof HeightMapBranch) {
      if (right instanceof HeightMapBranch) {
        let before = left.left, after = right.right
        let merged = left.merge(left.right, from - before.length - 1,
                                right.left, to - left.length - 1, nodes, start, end)
        return before.size > after.size
          ? this.update(before, right.update(merged, after))
          : this.update(right.update(before, merged), after)
      } else {
        let before = left.left
        return this.update(before, left.merge(left.right, from - before.length - 1,
                                              right, to, nodes, start, end))
      }
    } else if (right instanceof HeightMapBranch) {
      let after = right.right
      return this.update(right.merge(left, from, right.left, to, nodes, start, end), after)
    } else {
      let result = left.replace(from, left.length, nodes, start, null)
      let flat = result instanceof HeightMapBranch ? [result.left, result.right] : [result]
      return right.replace(to, right.length, flat, null, end)
    }
  }

  update(left: HeightMapNode, right: HeightMapNode): this {
    for (;;) {
      if (left.size >= (right.size << 1)) {
        let {left: newLeft, right: mid} = left as HeightMapBranch
        right = (left as HeightMapBranch).update(mid, right)
        left = newLeft
      } else if (right.size >= (left.size << 1)) {
        let {left: mid, right: newRight} = right as HeightMapBranch
        left = (right as HeightMapBranch).update(left, mid)
        right = newRight
      } else {
        break
      }
    }
    this.left = left; this.right = right
    this.height = left.height > -1 && right.height > -1 ? left.height + right.height : -1
    this.size = left.size + right.size
    this.length = left.length + 1 + right.length
    return this
  }

  computeHeight(oracle: HeightOracle, offset: number): number {
    if (this.height > -1) return this.height
    return this.height = this.left.computeHeight(oracle, offset) + 1 +
      this.right.computeHeight(oracle, offset + this.left.length + 1)
  }

  setMeasuredHeights(from: number, to: number, lines: number[], oracle: HeightOracle, offset: number): HeightMapNode {
    let {left, right} = this, rightStart = left.length + 1 + offset
    if (to < rightStart) {
      left = left.setMeasuredHeights(from, to, lines, oracle, offset)
    } else if (from >= rightStart) {
      right = right.setMeasuredHeights(from, to, lines, oracle, rightStart)
    } else {
      let i = 0, pos = from - 1
      while (i < lines.length && pos < rightStart - 2) { pos += lines[i] + 1; i += 2 }
      right = right.setMeasuredHeights(rightStart, to, lines.slice(i), oracle, rightStart)
      lines.length = i
      left = left.setMeasuredHeights(from, rightStart - 1, lines, oracle, offset)
    }
    return this.update(left, right)
  }

  static from(nodes: HeightMapNode[]): HeightMapNode {
    if (nodes.length == 1) return nodes[0]
    let mid = nodes.length >> 1, right = HeightMapBranch.from(nodes.slice(mid))
    nodes.length = mid
    return new HeightMapBranch(HeightMapBranch.from(nodes), right)
  }
}

const noRange: RangeDesc[] = []
const SKIP_DISTANCE = 1024

class NodeBuilder {
  active: RangeDesc[] = noRange
  nodes: HeightMapNode[] = []
  cursor: TextCursor
  writtenTo: number
  curLineStart: number = -1
  curLine: HeightMapLine | null = null
  text: string
  textPos: number = 0

  constructor(public pos: number, public doc: Text) {
    this.cursor = doc.iter()
    this.text = this.cursor.next(this.pos)
    this.writtenTo = pos
  }

  advance(pos: number) {
    while (this.pos < pos) {
      if (this.textPos == this.text.length) {
        if (!this.curLine && pos > this.pos + SKIP_DISTANCE) {
          this.pos = pos
          this.curLineStart = this.doc.lineStart(pos)
        }
        this.text = this.cursor.next(this.pos)
        this.textPos = 0
      } else {
        let end = Math.min(this.textPos + (pos - this.pos), this.text.length)
        for (let i = this.textPos; i < end; i++)
          if (this.text.charCodeAt(i) == 10) { end = i; break }
        let len = end - this.textPos
        if (len > 0) {
          this.pos += len
          if (this.curLine) {
            this.curLine.length += len
            this.writtenTo += len
          }
        }
        if (end < this.text.length && this.pos < pos) {
          if (this.curLine) this.curLine = null
          this.pos++
          this.curLineStart = this.pos
        }
      }
    }
  }

  advanceCollapsed(pos: number) {
    this.addDeco(this.pos - pos)
    this.pos = pos
  }

  addWidget(widget: WidgetType<any>) {
    this.addDeco(widget.estimatedHeight)
  }

  flushTo(pos: number) {
    if (pos > this.writtenTo) {
      this.nodes.push(new HeightMapRange(pos - this.writtenTo))
      this.writtenTo = pos
    }
  }

  addDeco(val: number) {
    if (!this.curLine) {
      this.flushTo(this.curLineStart)
      this.curLine = new HeightMapLine(this.pos - this.curLineStart)
      this.nodes.push(this.curLine)
      this.writtenTo = this.pos
    }
    this.curLine.addDeco(this.pos - this.curLineStart, val)
  }
}

function buildChangedNodes(doc: Text, decorations: ReadonlyArray<DecorationSet>, from: number, to: number): HeightMapNode[] {
  let builder = new NodeBuilder(from, doc)
  buildLineElements(decorations, from, to, builder, true)
  builder.flushTo(builder.pos)
  return builder.nodes
}
