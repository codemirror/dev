import {Text, TextCursor} from "../../doc/src/text"
import {ChangedRange} from "../../doc/src/diff"
import {DecorationSet, buildLineElements, RangeDesc, WidgetType} from "./decoration"

const wrappingWhiteSpace = ["pre-wrap", "normal", "pre-line"]

export class HeightOracle {
  doc: Text = Text.create("")
  lineWrapping: boolean = false
  heightSamples: {[key: number]: boolean} = {}
  lineHeight: number = 14
  lineLength: number = 30

  heightForRange(from: number, to: number): number {
    let lines = this.doc.linePos(to).line - this.doc.linePos(from).line + 1
    if (this.lineWrapping)
      lines += Math.ceil(((to - from) - (lines * this.lineLength * 0.5)) / this.lineLength)
    return this.lineHeight * lines
  }

  heightForLine(length: number): number {
    if (!this.lineWrapping) return this.lineHeight
    let lines = 1 + Math.ceil((length - this.lineLength) / (this.lineLength - 5))
    return lines * this.lineHeight
  }

  setDoc(doc: Text): this { this.doc = doc; return this }

  maybeRefresh(lineHeights: number[]): boolean {
    let newHeight = false
    for (let i = 1; i < lineHeights.length; i += 2) {
      let height = Math.floor(lineHeights[i] * 10) // Round to .1 pixels
      if (!this.heightSamples[height]) {
        newHeight = true
        this.heightSamples[height] = true
      }
    }
    return newHeight
  }

  refresh(whiteSpace: string, lineHeight: number, lineLength: number): boolean {
    let lineWrapping = wrappingWhiteSpace.indexOf(whiteSpace) > -1
    let changed = Math.round(lineHeight) != Math.round(this.lineHeight) || this.lineWrapping != lineWrapping
    this.lineWrapping = lineWrapping
    this.lineHeight = lineHeight
    this.lineLength = lineLength
    if (changed) this.heightSamples = {}
    return changed
  }
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

  abstract heightAt(pos: number, bias?: 1 | -1): number
  abstract startAtHeight(height: number, doc: Text): number
  abstract endAtHeight(height: number, doc: Text): number
  abstract replace(from: number, to: number, nodes: HeightMapNode[],
                   start: ReplaceSide | null, end: ReplaceSide | null): HeightMapNode
  abstract updateHeight(oracle: HeightOracle, offset: number, force: boolean,
                        from?: number, to?: number, lines?: number[]): HeightMapNode

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
  heightAt(pos: number, bias: 1 | -1 = -1): number { return bias < 0 ? 0 : this.height }

  startAtHeight(height: number, doc: Text): number { return 0 }
  endAtHeight(height: number, doc: Text): number { return this.length }

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

  updateHeight(oracle: HeightOracle, offset: number, force: boolean,
               from?: number, to?: number, lines?: number[]): HeightMapNode {
    if (lines) {
      this.height = lines[1]
    } else if (force || this.height < 0) {
      let len = this.length, minH = 0
      for (let i = 1; i < this.deco.length; i += 2) {
        let val = this.deco[i]
        if (val < 0) len += val
        else minH = Math.max(val, minH)
      }
      this.height = Math.max(oracle.heightForLine(len), minH)
    }
    return this
  }
}

class HeightMapRange extends HeightMapNode {
  get size(): number { return 1 }

  heightAt(pos: number) {
    return this.height * (pos / this.length)
  }

  startAtHeight(height: number, doc: Text): number {
    if (height < 0) return 0
    let {line} = doc.linePos(Math.floor(this.length * Math.min(1, height / this.height)))
    return doc.lineStart(line)
  }

  endAtHeight(height: number, doc: Text): number {
    if (height > this.height) return this.length
    let {line} = doc.linePos(Math.floor(this.length * Math.max(0, height / this.height)))
    return doc.lineEnd(line)
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

  updateHeight(oracle: HeightOracle, offset: number, force: boolean,
               from?: number, to?: number, lines?: number[]): HeightMapNode {
    if (lines) {
      let nodes = []
      if (from! > 0) {
        nodes.push(new HeightMapRange(from! - 1))
        nodes[0].updateHeight(oracle, offset, true)
      }
      for (let i = 0; i < lines.length; i += 2) {
        let line = new HeightMapLine(lines[i])
        line.height = lines[i + 1]
        nodes.push(line)
      }
      if (to! < this.length) {
        nodes.push(new HeightMapRange(this.length - to! - 1))
        nodes[nodes.length - 1].updateHeight(oracle, to!, true)
      }
      return HeightMapBranch.from(nodes)
    } else if (force || this.height < 0) {
      this.height = oracle.heightForRange(offset, offset + this.length)
    }
    return this
  }
}

class HeightMapBranch extends HeightMapNode {
  size: number

  constructor(public left: HeightMapNode, public right: HeightMapNode) {
    super(left.length + 1 + right.length)
    this.size = left.size + right.size
    if (left.height > -1 && right.height > -1) this.height = left.height + right.height
  }

  heightAt(pos: number, bias: 1 | -1 = -1): number {
    let leftLen = this.left.length
    return pos <= leftLen ? this.left.heightAt(pos, bias) : this.right.heightAt(pos - leftLen - 1, bias)
  }

  startAtHeight(height: number, doc: Text): number {
    let right = height - this.left.height
    return right < 0 ? this.left.startAtHeight(height, doc) : this.right.startAtHeight(right, doc)
  }
  endAtHeight(height: number, doc: Text): number {
    let right = height - this.left.height
    return right < 0 ? this.left.endAtHeight(height, doc) : this.right.endAtHeight(right, doc)
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
      if (left.size > (right.size << 1)) {
        let {left: newLeft, right: mid} = left as HeightMapBranch
        if (mid.size > newLeft.size) {
          let {left: midLeft, right: midRight} = mid as HeightMapBranch
          left = (left as HeightMapBranch).update(newLeft, midLeft)
          right = (mid as HeightMapBranch).update(midRight, right)
        } else {
          right = (left as HeightMapBranch).update(mid, right)
          left = newLeft
        }
      } else if (right.size > (left.size << 1)) {
        let {left: mid, right: newRight} = right as HeightMapBranch
        if (mid.size > newRight.size) {
          let {left: midLeft, right: midRight} = mid as HeightMapBranch
          right = (right as HeightMapBranch).update(midRight, newRight)
          left = (mid as HeightMapBranch).update(left, midLeft)
        } else {
          left = (right as HeightMapBranch).update(left, mid)
          right = newRight
        }
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

  updateHeight(oracle: HeightOracle, offset: number, force: boolean,
               from?: number, to?: number, lines?: number[]): HeightMapNode {
    if (lines) {
      let {left, right} = this, rightOffset = left.length + 1 + offset
      if (to! < rightOffset) {
        left = left.updateHeight(oracle, offset, force, from, to, lines)
        if (force) right.updateHeight(oracle, rightOffset, true)
      } else if (from! >= rightOffset) {
        right = right.updateHeight(oracle, rightOffset, force, from, to, lines)
        if (force) left.updateHeight(oracle, offset, true)
      } else {
        let i = 0, pos = from! - 1
        while (i < lines.length && pos < rightOffset - 2) { pos += lines[i] + 1; i += 2 }
        right = right.updateHeight(oracle, rightOffset, force, rightOffset, to, lines.slice(i))
        lines.length = i
        left = left.updateHeight(oracle, offset, force, from, rightOffset - 1, lines)
      }
      return this.update(left, right)
    } else if (force || this.height < 0) {
      this.left.updateHeight(oracle, offset, force)
      this.right.updateHeight(oracle, offset + this.left.length + 1, force)
      this.height = this.left.height + 1 + this.right.height
    }
    return this
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
  if (builder.nodes.length == 0) builder.nodes.push(new HeightMapRange(0))
  return builder.nodes
}
