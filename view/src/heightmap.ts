import {Text} from "../../doc/src/text"
import {ChangedRange} from "./changes"
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
  // Used to track, during updateHeight, if any actual heights changed
  heightChanged: boolean = false

  heightForGap(from: number, to: number): number {
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

  refresh(whiteSpace: string, lineHeight: number, lineLength: number, knownHeights: number[]): boolean {
    let lineWrapping = wrappingWhiteSpace.indexOf(whiteSpace) > -1
    let changed = Math.round(lineHeight) != Math.round(this.lineHeight) || this.lineWrapping != lineWrapping
    this.lineWrapping = lineWrapping
    this.lineHeight = lineHeight
    this.lineLength = lineLength
    if (changed) {
      this.heightSamples = {}
      for (let height of knownHeights) this.heightSamples[Math.floor(height * 10)] = true
    }
    return changed
  }
}

type LineIterator = (from: number, to: number, line: {readonly height: number, readonly hasCollapsedRanges: boolean}) => void

export abstract class HeightMap {
  constructor(
    public length: number, // The number of characters covered
    public height: number, // Height of this part of the document
    public outdated: boolean = true // Tracks whether the height needs to be recomputed
  ) {}

  abstract size: number

  abstract heightAt(pos: number, doc: Text, bias?: 1 | -1, offset?: number): number
  abstract posAt(height: number, doc: Text, bias?: 1 | -1, offset?: number): number
  abstract lineViewport(pos: number, doc: Text, offset?: number): Viewport
  abstract decomposeLeft(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newTo: number): void
  abstract decomposeRight(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newFrom: number): void
  abstract updateHeight(oracle: HeightOracle, offset?: number, force?: boolean,
                        from?: number, to?: number, lines?: number[]): HeightMap
  abstract toString(): void
  abstract forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: LineIterator): void

  setHeight(oracle: HeightOracle, height: number) {
    if (this.height != height) {
      this.height = height
      oracle.heightChanged = true
    }
  }

  // from/to are node-relative positions pointing into the node itself
  // newFrom/newTo are document-relative positions in the updated
  // document, used for querying line endings and such
  replace(from: number, to: number, nodes: HeightMap[], oracle: HeightOracle, newFrom: number, newTo: number): HeightMap {
    let result: HeightMap[] = []
    this.decomposeLeft(from, result, nodes[0], oracle, newFrom)
    let last
    if (nodes.length == 1) {
      last = result.pop()!
    } else {
      for (let i = 1; i < nodes.length - 1; i++) result.push(nodes[i])
      last = nodes[nodes.length - 1]
    }
    this.decomposeRight(to, result, last, oracle, newTo)
    return HeightMap.of(result)
  }

  applyChanges(decorations: ReadonlyArray<DecorationSet>, oracle: HeightOracle, changes: ReadonlyArray<ChangedRange>): HeightMap {
    let me: HeightMap = this
    for (let i = changes.length - 1; i >= 0; i--) {
      let range = changes[i]
      let nodes = buildChangedNodes(oracle, decorations, range.fromB, range.toB)
      me = me.replace(range.fromA, range.toA, nodes, oracle, range.fromB, range.toB)
    }
    return me
  }

  static empty() { return new HeightMapLine(0, 0) }

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

class HeightMapLine extends HeightMap {
  constructor(length: number, height: number, public deco: number[] = noDeco) { super(length, height) }

  get size(): number { return 1 }

  heightAt(pos: number, doc: Text, bias: 1 | -1): number { return bias < 0 ? 0 : this.height }

  posAt(height: number, doc: Text, bias: 1 | -1, offset: number = 0) {
    return offset + (bias < 0 ? 0 : this.length)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    return new Viewport(offset, offset + this.length)
  }

  replace(from: number, to: number, nodes: HeightMap[], oracle: HeightOracle, newFrom: number, newTo: number): HeightMap {
    if (nodes.length != 1 || (nodes[0] instanceof HeightMapGap && oracle.doc.lineEndAt(newFrom) < newTo))
      return super.replace(from, to, nodes, oracle, newFrom, newTo)
    this.deco = offsetDeco(this.deco, from, to, nodes[0].length)
    if (nodes[0] instanceof HeightMapLine) this.deco = insertDeco(this.deco, (nodes[0] as HeightMapLine).deco, from)
    this.length += nodes[0].length - (to - from)
    this.outdated = true
    return this
  }

  decomposeLeft(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newTo: number) {
    if (to == 0) {
      target.push(node)
    } else if (node instanceof HeightMapLine) {
      target.push(this.joinLine(to, this.length, node))
    } else {
      let nextEnd = oracle.doc.lineEndAt(newTo), breakInside = nextEnd < newTo + node.length
      let newLen = to + (breakInside ? nextEnd - newTo : node.length)
      target.push(new HeightMapLine(newLen, this.height, offsetDeco(this.deco, to, this.length, 0)))
      if (breakInside)
        target.push(new HeightMapGap(nextEnd + 1, newTo + node.length, oracle))
    }
  }

  decomposeRight(from: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newFrom: number) {
    if (from == this.length) {
      target.push(node)
    } else if (node instanceof HeightMapLine) {
      target.push(this.joinLine(0, from, node))
    } else {
      let prevStart = oracle.doc.lineStartAt(newFrom), breakInside = prevStart > newFrom - node.length
      if (breakInside)
        target.push(new HeightMapGap(newFrom - node.length, prevStart - 1, oracle))
      let newLen = (breakInside ? newFrom - prevStart : node.length) + (this.length - from)
      target.push(new HeightMapLine(newLen, this.height, offsetDeco(this.deco, 0, from, newLen - this.length)))
    }
  }

  joinLine(from: number, to: number, node: HeightMapLine): HeightMap {
    let deco = insertDeco(offsetDeco(this.deco, from, to, node.length), node.deco, from)
    return new HeightMapLine(this.length + node.length - (to - from), Math.max(this.height, node.height), deco)
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false,
               from?: number, to?: number, lines?: number[]): HeightMap {
    if (lines) {
      if (lines.length != 2) throw new Error("Mismatch between height map and line data")
      this.setHeight(oracle, lines[1])
    } else if (force || this.outdated) {
      let len = this.length, minH = 0
      for (let i = 1; i < this.deco.length; i += 2) {
        let val = this.deco[i]
        if (val < 0) len += val
        else minH = Math.max(val, minH)
      }
      this.setHeight(oracle, Math.max(oracle.heightForLine(len), minH))
    }
    this.outdated = false
    return this
  }

  toString() { return `line(${this.length}${this.deco.length ? ":" + this.deco.join(",") : ""})` }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: LineIterator) {
    f(offset, offset + this.length, this)
  }

  get hasCollapsedRanges(): boolean {
    for (let i = 1; i < this.deco.length; i += 2) if (this.deco[i] < 0) return true
    return false
  }
}

function offsetDeco(deco: number[], from: number, to: number, length: number): number[] {
  let result: number[] | null = null
  let off = length - (to - from)
  for (let i = 0; i < deco.length; i += 2) {
    let pos = deco[i]
    if (pos < from || pos > to && off == 0) continue
    if (!result) result = deco.slice(0, i)
    if (pos > to) result.push(pos + off, deco[i + 1])
  }
  return !result ? deco : result.length ? result : noDeco
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

class HeightMapGap extends HeightMap {
  constructor(from: number, to: number, oracle: HeightOracle) {
    super(to - from, oracle.heightForGap(from, to), false)
  }

  get size(): number { return 1 }

  heightAt(pos: number, doc: Text, bias: 1 | -1, offset: number = 0) {
    let firstLine = doc.linePos(offset).line, lastLine = doc.linePos(offset + this.length).line
    let lines = lastLine - firstLine + 1
    if (pos < 0) throw new Error("YOU")
    return (doc.linePos(pos).line - firstLine + (offset > 0 ? 1 : 0)) * (this.height / lines)
  }

  posAt(height: number, doc: Text, bias: 1 | -1, offset: number = 0): number {
    let firstLine = doc.linePos(offset).line, lastLine = doc.linePos(offset + this.length).line
    let line = firstLine + Math.floor((lastLine - firstLine) * Math.max(0, Math.min(1, height / this.height)))
    return bias < 0 ? doc.lineStart(line) : doc.lineEnd(line)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    return new Viewport(doc.lineStartAt(pos + offset), doc.lineEndAt(pos + offset))
  }

  replace(from: number, to: number, nodes: HeightMap[], oracle: HeightOracle, newFrom: number, newTo: number): HeightMap {
    if (nodes.length != 1 || !(nodes[0] instanceof HeightMapGap))
      return super.replace(from, to, nodes, oracle, newFrom, newTo)
    this.setHeight(oracle, oracle.heightForGap(newFrom - from, newTo + this.length - to))
    this.length += nodes[0].length - (to - from)
    return this
  }

  decomposeLeft(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newTo: number) {
    let newOffset = newTo - to
    if (node instanceof HeightMapGap) {
      target.push(new HeightMapGap(newOffset, newTo + node.length, oracle))
    } else {
      let lineStart = oracle.doc.lineStartAt(newTo)
      if (lineStart > newOffset) target.push(new HeightMapGap(newOffset, lineStart - 1, oracle))
      let deco = offsetDeco((node as HeightMapLine).deco, 0, 0, newTo - lineStart)
      target.push(new HeightMapLine(newTo + node.length - lineStart, node.height, deco))
    }
  }

  decomposeRight(from: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newFrom: number) {
    let newEnd = newFrom + (this.length - from)
    if (node instanceof HeightMapGap) {
      target.push(new HeightMapGap(newFrom - node.length, newEnd, oracle))
    } else {
      let lineEnd = oracle.doc.lineEndAt(newFrom)
      target.push(new HeightMapLine(lineEnd - (newFrom - from), node.height, (node as HeightMapLine).deco))
      if (newEnd > lineEnd) target.push(new HeightMapGap(lineEnd + 1, newEnd, oracle))
    }
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false,
               from?: number, to?: number, lines?: number[]): HeightMap {
    if (lines) {
      let nodes = []
      if (from! > offset)
        nodes.push(new HeightMapGap(offset, from! - 1, oracle))
      for (let i = 0; i < lines.length; i += 2)
        nodes.push(new HeightMapLine(lines[i], lines[i + 1]))
      if (to! < offset + this.length)
        nodes.push(new HeightMapGap(to! + 1, offset + this.length, oracle))
      for (let node of nodes) node.outdated = false
      oracle.heightChanged = true
      return HeightMap.of(nodes)
    } else if (force || this.outdated) {
      this.setHeight(oracle, oracle.heightForGap(offset, offset + this.length))
    }
    this.outdated = false
    return this
  }

  toString() { return `gap(${this.length})` }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: LineIterator) {
    let line = {height: -1, hasCollapsedRanges: false}
    for (let pos = Math.max(from, offset), end = Math.min(to, offset + this.length); pos < end;) {
      let end = oracle.doc.lineEndAt(pos)
      line.height = oracle.heightForLine(end - pos)
      f(pos, end, line)
      pos = end + 1
    }
  }
}

class HeightMapBranch extends HeightMap {
  size: number

  constructor(public left: HeightMap, public right: HeightMap) {
    super(left.length + 1 + right.length, left.height + right.height, left.outdated || right.outdated)
    this.size = left.size + right.size
  }

  heightAt(pos: number, doc: Text, bias: 1 | -1, offset: number = 0): number {
    let rightStart = offset + this.left.length + 1
    return pos < rightStart ? this.left.heightAt(pos, doc, bias, offset)
      : this.left.height + this.right.heightAt(pos, doc, bias, rightStart)
  }

  posAt(height: number, doc: Text, bias: -1 | 1, offset: number = 0): number {
    let right = height - this.left.height
    return right < 0 ? this.left.posAt(height, doc, bias, offset)
      : this.right.posAt(right, doc, bias, offset + this.left.length + 1)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    let rightStart = this.left.length + 1
    return pos < rightStart ? this.left.lineViewport(pos, doc, offset)
      : this.right.lineViewport(pos - rightStart, doc, offset + rightStart)
  }

  replace(from: number, to: number, nodes: HeightMap[], oracle: HeightOracle, newFrom: number, newTo: number): HeightMap {
    let rightStart = this.left.length + 1
    if (to < rightStart)
      return this.balanced(this.left.replace(from, to, nodes, oracle, newFrom, newTo), this.right)
    else if (from >= rightStart)
      return this.balanced(this.left, this.right.replace(from - rightStart, to - rightStart, nodes, oracle, newFrom, newTo))
    else
      return super.replace(from, to, nodes, oracle, newFrom, newTo)
  }

  decomposeLeft(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newTo: number) {
    let rightStart = this.left.length + 1
    if (to < rightStart) {
      this.left.decomposeLeft(to, target, node, oracle, newTo)
    } else {
      target.push(this.left)
      this.right.decomposeLeft(to - rightStart, target, node, oracle, newTo)
    }
  }

  decomposeRight(from: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newFrom: number) {
    let rightStart = this.left.length + 1
    if (from < rightStart) {
      this.left.decomposeRight(from, target, node, oracle, newFrom)
      target.push(this.right)
    } else {
      this.right.decomposeRight(from - rightStart, target, node, oracle, newFrom)
    }
  }

  balanced(left: HeightMap, right: HeightMap): HeightMap {
    if (left.size > 2 * right.size || right.size > 2 * left.size) return HeightMap.of([left, right])
    this.left = left; this.right = right
    this.height = left.height + right.height
    this.outdated = left.outdated || right.outdated
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
        // FIXME try to reduce the array copying here?
        let i = 0, pos = from! - 1
        while (i < lines.length && pos <= rightOffset - 2) { pos += lines[i] + 1; i += 2 }
        right = right.updateHeight(oracle, rightOffset, force, rightOffset, to, lines.slice(i))
        lines.length = i
        left = left.updateHeight(oracle, offset, force, from, rightOffset - 1, lines)
      }
      return this.balanced(left, right)
    } else if (force || this.outdated) {
      this.left.updateHeight(oracle, offset, force)
      this.right.updateHeight(oracle, offset + this.left.length + 1, force)
      this.height = this.left.height + this.right.height
    }
    this.outdated = false
    return this
  }

  toString() { return this.left + " " + this.right }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: LineIterator) {
    let rightStart = offset + this.left.length + 1
    if (from < rightStart) this.left.forEachLine(from, to, offset, oracle, f)
    if (to >= rightStart) this.right.forEachLine(from, to, rightStart, oracle, f)
  }
}

// FIXME This could probably be optimized. Measure how often it's
// actually running during regular use. (Current theory is that,
// because most of the document will simply be an unparsed gap, and
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

  constructor(public pos: number, public oracle: HeightOracle) {
    this.writtenTo = pos
  }

  advance(pos: number) {
    if (pos <= this.pos) return
    if (this.curLine) {
      if (this.lineEnd < 0) this.lineEnd = this.oracle.doc.lineEndAt(this.pos)
      if (pos > this.lineEnd) {
        this.curLine.length += (this.lineEnd - this.pos)
        this.curLine.updateHeight(this.oracle, this.lineEnd - this.curLine.length)
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
      this.nodes.push(new HeightMapGap(this.writtenTo, pos, this.oracle))
      this.writtenTo = pos
    }
  }

  addDeco(val: number) {
    if (!this.curLine) {
      this.lineStart = Math.max(this.writtenTo, this.oracle.doc.lineStartAt(this.pos))
      this.flushTo(this.lineStart - 1)
      this.nodes.push(this.curLine = new HeightMapLine(this.pos - this.lineStart, 0, []))
      this.writtenTo = this.pos
    }
    this.curLine.deco.push(this.pos - this.lineStart, val)
  }

  ignoreRange(value: Decoration) { return !(value as RangeDecoration).collapsed }
  ignorePoint(value: Decoration) { return !value.widget }
}

function buildChangedNodes(oracle: HeightOracle, decorations: ReadonlyArray<DecorationSet>, from: number, to: number): HeightMap[] {
  let builder = new NodeBuilder(from, oracle)
  RangeSet.iterateSpans(decorations, from, to, builder)
  if (builder.curLine) builder.curLine.updateHeight(oracle, builder.pos - builder.curLine.length)
  else builder.flushTo(builder.pos)
  if (builder.nodes.length == 0) builder.nodes.push(new HeightMapGap(0, 0, oracle))
  return builder.nodes
}
