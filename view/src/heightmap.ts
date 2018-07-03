import {Text} from "../../doc/src/text"
import {ChangedRange} from "../../doc/src/diff"
import {RangeSet, RangeIterator} from "../../rangeset/src/rangeset"
import {DecorationSet, RangeDecoration, Decoration} from "./decoration"
import {Viewport} from "./viewport"

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
    let lines = 1 + Math.max(0, Math.ceil((length - this.lineLength) / (this.lineLength - 5)))
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
    let inside = doc.lineEndAt(start) - start
    return new ReplaceSide(inside >= length ? -1 : inside, start - doc.lineStartAt(start))
  }
  static end(doc: Text, end: number, length: number): ReplaceSide {
    let inside = end - doc.lineStartAt(end)
    return new ReplaceSide(inside >= length ? -1 : inside, doc.lineEndAt(end) - end)
  }
}

export abstract class HeightMap {
  constructor(
    public length: number, // The number of characters covered
    public height: number // Height of this part of the document, or -1 when uninitialized
  ) {}

  abstract size: number

  abstract heightAt(pos: number, bias?: 1 | -1): number
  abstract posAt(height: number, doc: Text, bias?: 1 | -1, offset?: number): number
  abstract lineViewport(pos: number, doc: Text, offset?: number): Viewport
  abstract decomposeLeft(to: number, target: HeightMap[], node: HeightMap, start: ReplaceSide): void
  abstract decomposeRight(to: number, target: HeightMap[], node: HeightMap, start: ReplaceSide): void
  abstract updateHeight(oracle: HeightOracle, offset?: number, force?: boolean,
                        from?: number, to?: number, lines?: number[]): HeightMap
  abstract toString(): void

  replace(from: number, to: number, nodes: HeightMap[], start: ReplaceSide, end: ReplaceSide): HeightMap {
    let result: HeightMap[] = []
    this.decomposeLeft(from, result, nodes[0], start)
    let last = decomposeNew(result, nodes)
    this.decomposeRight(to, result, last, end)
    return HeightMap.of(result)
  }

  applyChanges(doc: Text, decorations: ReadonlyArray<DecorationSet>, changes: ReadonlyArray<ChangedRange>): HeightMap {
    let me: HeightMap = this
    for (let i = changes.length - 1; i >= 0; i--) {
      let range = changes[i]
      let nodes = buildChangedNodes(doc, decorations, range.fromB, range.toB)
      me = me.replace(range.fromA, range.toA, nodes, ReplaceSide.start(doc, range.fromB, nodes[0].length),
                      ReplaceSide.end(doc, range.toB, nodes[nodes.length - 1].length))
    }
    return me
  }

  static empty() { return new HeightMapRange(0, -1) }

  static of(nodes: HeightMap[]): HeightMap {
    if (nodes.length == 1) return nodes[0]

    let i = 0, j = nodes.length, before = 0, after = 0
    while (i < j) {
      if (before < after) before += nodes[i++].size
      else after += nodes[--j].size
    }
    for (;;) {
      if (before > after * 2) {
        let {left, right} = nodes[i - 1] as HeightMapBranch
        nodes.splice(i - 1, 1, left, right)
        before -= right.size
        after += right.size
      } else if (after > before * 2) {
        let {left, right} = nodes[i] as HeightMapBranch
        nodes.splice(i++, 1, left, right)
        after -= left.size
        before += left.size
      } else {
        break
      }
    }
    return new HeightMapBranch(HeightMap.of(nodes.slice(0, i)), HeightMap.of(nodes.slice(i)))
  }
}

const noDeco: number[] = []

export class HeightMapLine extends HeightMap {
  constructor(length: number, height: number = -1, public deco: number[] = noDeco) { super(length, height) }

  get size(): number { return 1 }

  heightAt(pos: number, bias: 1 | -1 = -1): number { return bias < 0 ? 0 : this.height }

  posAt(height: number, doc: Text, bias: 1 | -1 = -1, offset: number = 0) {
    return offset + (bias < 0 ? 0 : this.length)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    return new Viewport(offset, offset + this.length)
  }

  replace(from: number, to: number, nodes: HeightMap[], start: ReplaceSide, end: ReplaceSide): HeightMap {
    if (nodes.length != 1 || !(nodes[0] instanceof HeightMapLine))
      return super.replace(from, to, nodes, start, end)
    this.deco = insertDeco(offsetDeco(this.deco, from, to, nodes[0].length), (nodes[0] as HeightMapLine).deco, from)
    this.length += nodes[0].length - (to - from)
    this.height = -1
    return this
  }

  decomposeLeft(to: number, target: HeightMap[], node: HeightMap, start: ReplaceSide) {
    if (to == 0) {
      target.push(node)
    } else if (node instanceof HeightMapLine) {
      target.push(this.joinLine(to, this.length, node))
    } else {
      let addLen = start.breakInside == -1 ? node.length : start.breakInside
      target.push(new HeightMapLine(to + addLen, -1, offsetDeco(this.deco, to, this.length, 0)))
      if (start.breakInside >= 0)
        target.push(new HeightMapRange(node.length - start.breakInside - 1, -1))
    }
  }

  decomposeRight(from: number, target: HeightMap[], node: HeightMap, end: ReplaceSide) {
    if (from == this.length) {
      target.push(node)
    } else if (node instanceof HeightMapLine) {
      target.push(this.joinLine(0, from, node))
    } else {
      let addLen = end.breakInside == -1 ? node.length : end.breakInside
      if (end.breakInside >= 0)
        target.push(new HeightMapRange(node.length - end.breakInside - 1, -1))
      target.push(new HeightMapLine(this.length - from + addLen, -1, offsetDeco(this.deco, 0, from, addLen)))
    }
  }

  joinLine(from: number, to: number, node: HeightMapLine): HeightMap {
    let deco = insertDeco(offsetDeco(this.deco, from, to, node.length), node.deco, from)
    return new HeightMapLine(this.length + node.length - (to - from), -1, deco)
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false,
               from?: number, to?: number, lines?: number[]): HeightMap {
    if (lines) {
      if (lines.length != 2) throw new Error("Mismatch between height map and line data")
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

  toString() { return `line(${this.length}${this.deco.length ? ":" + this.deco.join(",") : ""})` }
}

function offsetDeco(deco: number[], from: number, to: number, length: number): number[] {
  if ((from == to && length == 0) || deco.length == 0) return deco
  let result = []
  let off = length - (to - from)
  for (let i = 0; i < deco.length; i += 2) {
    let pos = deco[i]
    if (pos < from) result.push(pos, deco[i + 1])
    else if (pos > to) result.push(pos + off, deco[i + 1])
  }
  return result.length ? result : noDeco
}

function insertDeco(deco: number[], newDeco: number[], pos: number): number[] {
  if (newDeco.length == 0) return deco
  let result = [], inserted = false
  for (let i = 0;; i += 2) {
    let next = i == deco.length ? 2e9 : deco[i]
    if (!inserted && next > pos) {
      for (let j = 0; j < newDeco.length; j += 2) result.push(newDeco[j] + pos, newDeco[j + 1])
      inserted = true
    }
    if (next == 2e9) return result
    result.push(next, deco[i + 1])
  }
}

export class HeightMapRange extends HeightMap {
  get size(): number { return 1 }

  heightAt(pos: number) {
    return this.height * (pos / this.length)
  }

  posAt(height: number, doc: Text, bias: 1 | -1 = -1, offset: number = 0): number {
    let pos = offset + Math.floor(this.length * Math.max(0, Math.min(1, height / this.height)))
    return bias < 0 ? doc.lineStartAt(pos) : doc.lineEndAt(pos)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    return new Viewport(doc.lineStartAt(pos + offset), doc.lineEndAt(pos + offset))
  }

  replace(from: number, to: number, nodes: HeightMap[], start: ReplaceSide, end: ReplaceSide): HeightMap {
    if (nodes.length != 1 || !(nodes[0] instanceof HeightMapRange))
      return super.replace(from, to, nodes, start, end)
    this.length += nodes[0].length - (to - from)
    this.height = -1
    return this
  }

  decomposeLeft(to: number, target: HeightMap[], node: HeightMap, start: ReplaceSide) {
    if (node instanceof HeightMapRange) {
      target.push(new HeightMapRange(to + node.length, -1))
    } else {
      let length = to - start.nextBreak - 1
      if (length > 0) target.push(new HeightMapRange(length, -1))
      let deco = offsetDeco((node as HeightMapLine).deco, 0, 0, start.nextBreak)
      target.push(new HeightMapLine(node.length + start.nextBreak, -1, deco))
    }
  }

  decomposeRight(from: number, target: HeightMap[], node: HeightMap, end: ReplaceSide) {
    if (node instanceof HeightMapRange) {
      target.push(new HeightMapRange(this.length - from + node.length, -1))
    } else {
      target.push(new HeightMapLine(node.length + end.nextBreak, -1, (node as HeightMapLine).deco))
      let length = this.length - (end.nextBreak + 1)
      if (length > 0) target.push(new HeightMapRange(length, -1))
    }
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false,
               from?: number, to?: number, lines?: number[]): HeightMap {
    if (lines) {
      let nodes = []
      if (from! > offset) {
        nodes.push(new HeightMapRange(from! - offset - 1, -1))
        nodes[0].updateHeight(oracle, offset, true)
      }
      for (let i = 0; i < lines.length; i += 2) {
        let line = new HeightMapLine(lines[i])
        line.height = lines[i + 1]
        nodes.push(line)
      }
      if (to! < offset + this.length) {
        nodes.push(new HeightMapRange(offset + this.length - to! - 1, -1))
        nodes[nodes.length - 1].updateHeight(oracle, to!, true)
      }
      return HeightMap.of(nodes)
    } else if (force || this.height < 0) {
      this.height = oracle.heightForRange(offset, offset + this.length)
    }
    return this
  }

  toString() { return `range(${this.length})` }
}

export class HeightMapBranch extends HeightMap {
  size: number

  constructor(public left: HeightMap, public right: HeightMap) {
    super(left.length + 1 + right.length, -1)
    this.size = left.size + right.size
    if (left.height > -1 && right.height > -1) this.height = left.height + right.height
  }

  heightAt(pos: number, bias: 1 | -1 = -1): number {
    let leftLen = this.left.length
    return pos <= leftLen ? this.left.heightAt(pos, bias) : this.left.height + this.right.heightAt(pos - leftLen - 1, bias)
  }

  posAt(height: number, doc: Text, bias: -1 | 1 = -1, offset: number = 0): number {
    let right = height - this.left.height
    return right < 0 ? this.left.posAt(height, doc, bias, offset)
      : this.right.posAt(right, doc, bias, offset + this.left.length + 1)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    let rightStart = this.left.length + 1
    return pos < rightStart ? this.left.lineViewport(pos, doc, offset)
      : this.right.lineViewport(pos - rightStart, doc, offset + rightStart)
  }

  replace(from: number, to: number, nodes: HeightMap[], start: ReplaceSide, end: ReplaceSide): HeightMap {
    let rightStart = this.left.length + 1
    if (to < rightStart) {
      return this.balanced(this.left.replace(from, to, nodes, start, end), this.right)
    } else if (from >= rightStart) {
      return this.balanced(this.left, this.right.replace(from - rightStart, to - rightStart, nodes, start, end))
    } else {
      let decomposed: HeightMap[] = []
      this.left.decomposeLeft(from, decomposed, nodes[0], start)
      let last = decomposeNew(decomposed, nodes)
      this.right.decomposeRight(to - rightStart, decomposed, last, end)
      return HeightMap.of(decomposed)
    }
  }

  decomposeLeft(to: number, target: HeightMap[], node: HeightMap, start: ReplaceSide) {
    let rightStart = this.left.length + 1
    if (to < rightStart) {
      this.left.decomposeLeft(to, target, node, start)
    } else {
      target.push(this.left)
      this.right.decomposeLeft(to - rightStart, target, node, start)
    }
  }

  decomposeRight(from: number, target: HeightMap[], node: HeightMap, end: ReplaceSide) {
    let rightStart = this.left.length + 1
    if (from < rightStart) {
      this.left.decomposeRight(from, target, node, end)
      target.push(this.right)
    } else {
      this.right.decomposeRight(from - rightStart, target, node, end)
    }
  }

  balanced(left: HeightMap, right: HeightMap): HeightMap {
    if (left.size > 2 * right.size || right.size > 2 * left.size) return HeightMap.of([left, right])
    this.left = left; this.right = right
    this.height = left.height > -1 && right.height > -1 ? left.height + right.height : -1
    this.size = left.size + right.size
    this.length = left.length + 1 + right.length
    return this
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false,
               from?: number, to?: number, lines?: number[]): HeightMap {
    if (lines) {
      let {left, right} = this, rightOffset = offset + left.length + 1
      if (to! < rightOffset) {
        left = left.updateHeight(oracle, offset, force, from, to, lines)
        if (force) right.updateHeight(oracle, rightOffset, true)
      } else if (from! >= rightOffset) {
        right = right.updateHeight(oracle, rightOffset, force, from, to, lines)
        if (force) left.updateHeight(oracle, offset, true)
      } else {
        let i = 0, pos = from! - 1
        while (i < lines.length && pos <= rightOffset - 2) { pos += lines[i] + 1; i += 2 }
        right = right.updateHeight(oracle, rightOffset, force, rightOffset, to, lines.slice(i))
        lines.length = i
        left = left.updateHeight(oracle, offset, force, from, rightOffset - 1, lines)
      }
      return this.balanced(left, right)
    } else if (force || this.height < 0) {
      this.left.updateHeight(oracle, offset, force)
      this.right.updateHeight(oracle, offset + this.left.length + 1, force)
      this.height = this.left.height + this.right.height
    }
    return this
  }

  toString() { return this.left + " " + this.right }
}

// FIXME This could probably be optimized. Measure how often it's
// actually running during regular use. (Current theory is that,
// becuase most of the document will simply be an unparsed range, and
// collapsed regions/widgets are relatively rare, and the viewport is
// filled in through updateHeight, it's not going to be calling
// `lineEndAt`/`lineStartAt` a significant amount of times except in
// pathological circumstances.)
class NodeBuilder implements RangeIterator<Decoration> {
  nodes: HeightMap[] = []
  writtenTo: number
  lineStart: number = -1
  lineEnd: number = -1
  curLine: HeightMapLine | null = null

  constructor(public pos: number, public doc: Text) {
    this.writtenTo = pos
  }

  advance(pos: number) {
    if (pos <= this.pos) return
    if (this.curLine) {
      if (this.lineEnd < 0) this.lineEnd = this.doc.lineEndAt(this.pos)
      if (pos > this.lineEnd) {
        this.curLine.length += (this.lineEnd - this.pos)
        this.curLine = null
        this.writtenTo = this.lineEnd + 1
        this.lineEnd = -1
      } else {
        this.curLine.length += (pos - this.pos)
        this.writtenTo = pos
      }
    } else if (this.lineEnd > -1 && pos > this.lineEnd) {
      this.lineEnd = -1
    }
    this.pos = pos
  }

  advanceCollapsed(pos: number) {
    if (pos <= this.pos) return
    this.addDeco(this.pos - pos)
    if (this.curLine) {
      this.curLine.length += pos - this.pos
      this.writtenTo = pos
      if (this.lineEnd < pos) this.lineEnd = -1
    }
    this.pos = pos
  }

  point(deco: Decoration) {
    this.addDeco(deco.widget!.estimatedHeight)
  }

  flushTo(pos: number) {
    if (pos > this.writtenTo) {
      this.nodes.push(new HeightMapRange(pos - this.writtenTo, -1))
      this.writtenTo = pos
    }
  }

  addDeco(val: number) {
    if (!this.curLine) {
      this.lineStart = Math.max(this.writtenTo, this.doc.lineStartAt(this.pos))
      this.flushTo(this.lineStart - 1)
      this.nodes.push(this.curLine = new HeightMapLine(this.pos - this.lineStart, -1))
      this.writtenTo = this.pos
    }
    this.curLine.deco.push(this.pos - this.lineStart, val)
  }

  ignoreRange(value: Decoration) { return !(value as RangeDecoration).collapsed }
  ignorePoint(value: Decoration) { return !value.widget }
}

function buildChangedNodes(doc: Text, decorations: ReadonlyArray<DecorationSet>, from: number, to: number): HeightMap[] {
  let builder = new NodeBuilder(from, doc)
  RangeSet.iterateSpans(decorations, from, to, builder)
  builder.flushTo(builder.pos)
  if (builder.nodes.length == 0) builder.nodes.push(new HeightMapRange(0, -1))
  return builder.nodes
}

function decomposeNew(target: HeightMap[], nodes: HeightMap[]): HeightMap {
  if (nodes.length == 1) {
    return target.pop()!
  } else {
    for (let i = 1; i < nodes.length - 1; i++) target.push(nodes[i])
    return nodes[nodes.length - 1]
  }
}
