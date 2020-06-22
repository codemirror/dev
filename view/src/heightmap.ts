import {Text} from "@codemirror/next/text"
import {ChangeSet} from "@codemirror/next/state"
import {RangeSet, SpanIterator} from "@codemirror/next/rangeset"
import {DecorationSet, PointDecoration, Decoration, BlockType, addRange} from "./decoration"
import {ChangedRange} from "./extension"
import {Direction} from "./bidi"

const wrappingWhiteSpace = ["pre-wrap", "normal", "pre-line"]

export class HeightOracle {
  doc: Text = Text.empty
  lineWrapping: boolean = false
  direction: Direction = Direction.LTR
  heightSamples: {[key: number]: boolean} = {}
  lineHeight: number = 14
  charWidth: number = 7
  lineLength: number = 30
  // Used to track, during updateHeight, if any actual heights changed
  heightChanged: boolean = false

  heightForGap(from: number, to: number): number {
    let lines = this.doc.lineAt(to).number - this.doc.lineAt(from).number + 1
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

  mustRefresh(lineHeights: number[], whiteSpace: string, direction: Direction): boolean {
    let newHeight = false
    for (let i = 0; i < lineHeights.length; i++) {
      let h = lineHeights[i]
      if (h < 0) {
        i++
      } else if (!this.heightSamples[Math.floor(h * 10)]) { // Round to .1 pixels
        newHeight = true
        this.heightSamples[Math.floor(h * 10)] = true
      }
    }
    return newHeight || (wrappingWhiteSpace.indexOf(whiteSpace) > -1) != this.lineWrapping || this.direction != direction
  }

  refresh(whiteSpace: string, direction: Direction, lineHeight: number, charWidth: number,
          lineLength: number, knownHeights: number[]): boolean {
    let lineWrapping = wrappingWhiteSpace.indexOf(whiteSpace) > -1
    let changed = Math.round(lineHeight) != Math.round(this.lineHeight) ||
      this.lineWrapping != lineWrapping ||
      this.direction != direction
    this.lineWrapping = lineWrapping
    this.direction = direction
    this.lineHeight = lineHeight
    this.charWidth = charWidth
    this.lineLength = lineLength
    if (changed) {
      this.heightSamples = {}
      for (let i = 0; i < knownHeights.length; i++) {
        let h = knownHeights[i]
        if (h < 0) i++
        else this.heightSamples[Math.floor(h * 10)] = true
      }
    }
    return changed
  }
}

// This object is used by `updateHeight` to make DOM measurements
// arrive at the right nides. The `heights` array is a sequence of
// block heights, starting from position `from`.
export class MeasuredHeights {
  public index = 0
  constructor(readonly from: number, readonly heights: number[]) {}
  get more() { return this.index < this.heights.length }
}

/// Record used to represent information about a block-level element
/// in the editor view.
export class BlockInfo {
  /// @internal
  constructor(
    /// The start of the element in the document.
    readonly from: number,
    /// The length of the element.
    readonly length: number,
    /// The top position of the element.
    readonly top: number,
    /// Its height.
    readonly height: number,
    /// The type of element this is. When querying lines, this may be
    /// an array of all the blocks that make up the line.
    readonly type: BlockType | readonly BlockInfo[]
  ) {}

  /// The end of the element as a document position.
  get to() { return this.from + this.length }
  /// The bottom position of the element.
  get bottom() { return this.top + this.height }

  /// @internal
  join(other: BlockInfo) {
    let detail = (Array.isArray(this.type) ? this.type : [this])
      .concat(Array.isArray(other.type) ? other.type : [other])
    return new BlockInfo(this.from, this.length + other.length,
                         this.top, this.height + other.height, detail)
  }
}

export enum QueryType { ByPos, ByHeight, ByPosNoHeight }

const enum Flag { Break = 1, Outdated = 2, SingleLine = 4 }

const Epsilon = 1e-4

export abstract class HeightMap {
  constructor(
    public length: number, // The number of characters covered
    public height: number, // Height of this part of the document
    public flags: number = Flag.Outdated
  ) {}

  size!: number

  get outdated() { return (this.flags & Flag.Outdated) > 0 }
  set outdated(value) { this.flags = (value ? Flag.Outdated : 0) | (this.flags & ~Flag.Outdated) }

  abstract blockAt(height: number, doc: Text, top: number, offset: number): BlockInfo
  abstract lineAt(value: number, type: QueryType, doc: Text, top: number, offset: number): BlockInfo
  abstract forEachLine(from: number, to: number, doc: Text, top: number, offset: number, f: (line: BlockInfo) => void): void

  abstract updateHeight(oracle: HeightOracle, offset?: number, force?: boolean, measured?: MeasuredHeights): HeightMap
  abstract toString(): void

  setHeight(oracle: HeightOracle, height: number) {
    if (this.height != height) {
      if (Math.abs(this.height - height) > Epsilon) oracle.heightChanged = true
      this.height = height
    }
  }

  // Base case is to replace a leaf node, which simply builds a tree
  // from the new nodes and returns that (HeightMapBranch and
  // HeightMapGap override this to actually use from/to)
  replace(_from: number, _to: number, nodes: (HeightMap | null)[]): HeightMap {
    return HeightMap.of(nodes)
  }

  // Again, these are base cases, and are overridden for branch and gap nodes.
  decomposeLeft(_to: number, result: (HeightMap | null)[]) { result.push(this) }
  decomposeRight(_from: number, result: (HeightMap | null)[]) { result.push(this) }

  applyChanges(decorations: readonly DecorationSet[], oldDoc: Text, oracle: HeightOracle,
               changes: readonly ChangedRange[]): HeightMap {
    let me: HeightMap = this
    for (let i = changes.length - 1; i >= 0; i--) {
      let {fromA, toA, fromB, toB} = changes[i]
      let start = me.lineAt(fromA, QueryType.ByPosNoHeight, oldDoc, 0, 0)
      let end = start.to >= toA ? start : me.lineAt(toA, QueryType.ByPosNoHeight, oldDoc, 0, 0)
      toB += end.to - toA; toA = end.to
      while (i > 0 && start.from <= changes[i - 1].toA) {
        fromA = changes[i - 1].fromA
        fromB = changes[i - 1].fromB
        i--
        if (fromA < start.from) start = me.lineAt(fromA, QueryType.ByPosNoHeight, oldDoc, 0, 0)
      }
      fromB += start.from - fromA; fromA = start.from
      let nodes = NodeBuilder.build(oracle, decorations, fromB, toB)
      me = me.replace(fromA, toA, nodes)
    }
    return me.updateHeight(oracle, 0)
  }

  static empty(): HeightMap { return new HeightMapText(0, 0) }

  // nodes uses null values to indicate the position of line breaks.
  // There are never line breaks at the start or end of the array, or
  // two line breaks next to each other, and the array isn't allowed
  // to be empty (same restrictions as return value from the builder).
  static of(nodes: (HeightMap | null)[]): HeightMap {
    if (nodes.length == 1) return nodes[0] as HeightMap

    let i = 0, j = nodes.length, before = 0, after = 0
    for (;;) {
      if (i == j) {
        if (before > after * 2) {
          let split = nodes[i - 1] as HeightMapBranch
          if (split.break) nodes.splice(--i, 1, split.left, null, split.right)
          else nodes.splice(--i, 1, split.left, split.right)
          j += 1 + split.break
          before -= split.size
        } else if (after > before * 2) {
          let split = nodes[j] as HeightMapBranch
          if (split.break) nodes.splice(j, 1, split.left, null, split.right)
          else nodes.splice(j, 1, split.left, split.right)
          j += 2 + split.break
          after -= split.size
        } else {
          break
        }
      } else if (before < after) {
        let next = nodes[i++]
        if (next) before += next.size
      } else {
        let next = nodes[--j]
        if (next) after += next.size
      }
    }

    let brk = 0
    if (nodes[i - 1] == null) { brk = 1; i-- }
    else if (nodes[i] == null) { brk = 1; j++ }
    return new HeightMapBranch(HeightMap.of(nodes.slice(0, i)), brk, HeightMap.of(nodes.slice(j)))
  }
}

HeightMap.prototype.size = 1

class HeightMapBlock extends HeightMap {
  constructor(length: number, height: number, readonly type: BlockType) { super(length, height) }

  blockAt(_height: number, _doc: Text, top: number, offset: number) {
    return new BlockInfo(offset, this.length, top, this.height, this.type)
  }

  lineAt(_value: number, _type: QueryType, doc: Text, top: number, offset: number) {
    return this.blockAt(0, doc, top, offset)
  }

  forEachLine(_from: number, _to: number, doc: Text, top: number, offset: number, f: (line: BlockInfo) => void) {
    f(this.blockAt(0, doc, top, offset))
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, _force: boolean = false, measured?: MeasuredHeights) {
    if (measured && measured.from <= offset && measured.more)
      this.setHeight(oracle, measured.heights[measured.index++])
    this.outdated = false
    return this
  }

  toString() { return `block(${this.length})` }
}

class HeightMapText extends HeightMapBlock {
  public collapsed = 0 // Amount of collapsed content in the line
  public widgetHeight = 0 // Maximum inline widget height

  constructor(length: number, height: number) { super(length, height, BlockType.Text) }

  replace(_from: number, _to: number, nodes: (HeightMap | null)[]): HeightMap {
    let node = nodes[0]
    if (nodes.length == 1 && (node instanceof HeightMapText || node instanceof HeightMapGap && (node.flags & Flag.SingleLine)) &&
        Math.abs(this.length - node.length) < 10) {
      if (node instanceof HeightMapGap) node = new HeightMapText(node.length, this.height)
      else node.height = this.height
      if (!this.outdated) node.outdated = false
      return node
    } else {
      return HeightMap.of(nodes)
    }
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights) {
    if (measured && measured.from <= offset && measured.more)
      this.setHeight(oracle, measured.heights[measured.index++])
    else if (force || this.outdated)
      this.setHeight(oracle, Math.max(this.widgetHeight, oracle.heightForLine(this.length - this.collapsed)))
    this.outdated = false
    return this
  }

  toString() {
    return `line(${this.length}${this.collapsed ? -this.collapsed : ""}${this.widgetHeight ? ":" + this.widgetHeight : ""})`
  }
}

class HeightMapGap extends HeightMap {
  constructor(length: number) { super(length, 0) }

  private lines(doc: Text, offset: number): {firstLine: number, lastLine: number, lineHeight: number} {
    let firstLine = doc.lineAt(offset).number, lastLine = doc.lineAt(offset + this.length).number
    return {firstLine, lastLine, lineHeight: this.height / (lastLine - firstLine + 1)}
  }

  blockAt(height: number, doc: Text, top: number, offset: number) {
    let {firstLine, lastLine, lineHeight} = this.lines(doc, offset)
    let line = Math.max(0, Math.min(lastLine - firstLine, Math.floor((height - top) / lineHeight)))
    let {from, length} = doc.line(firstLine + line)
    return new BlockInfo(from, length, top + lineHeight * line, lineHeight, BlockType.Text)
  }

  lineAt(value: number, type: QueryType, doc: Text, top: number, offset: number) {
    if (type == QueryType.ByHeight) return this.blockAt(value, doc, top, offset)
    if (type == QueryType.ByPosNoHeight) {
      let {from, to} = doc.lineAt(value)
      return new BlockInfo(from, to - from, 0, 0, BlockType.Text)
    }
    let {firstLine, lineHeight} = this.lines(doc, offset)
    let {from, length, number} = doc.lineAt(value)
    return new BlockInfo(from, length, top + lineHeight * (number - firstLine), lineHeight, BlockType.Text)
  }

  forEachLine(from: number, to: number, doc: Text, top: number, offset: number, f: (line: BlockInfo) => void) {
    let {firstLine, lastLine, lineHeight} = this.lines(doc, offset)
    for (let line = firstLine; line <= lastLine; line++) {
      let {from, to} = doc.line(line)
      if (from > to) break
      if (to >= from) f(new BlockInfo(from, to - from, top, top += lineHeight, BlockType.Text))
    }
  }

  replace(from: number, to: number, nodes: (HeightMap | null)[]): HeightMap {
    let after = this.length - to
    if (after > 0) {
      let last = nodes[nodes.length - 1]
      if (last instanceof HeightMapGap) nodes[nodes.length - 1] = new HeightMapGap(last.length + after)
      else nodes.push(null, new HeightMapGap(after - 1))
    }
    if (from > 0) {
      let first = nodes[0]
      if (first instanceof HeightMapGap) nodes[0] = new HeightMapGap(from + first.length)
      else nodes.unshift(new HeightMapGap(from - 1), null)
    }
    return HeightMap.of(nodes)
  }

  decomposeLeft(to: number, result: (HeightMap | null)[]) {
    result.push(new HeightMapGap(to - 1), null)
  }

  decomposeRight(from: number, result: (HeightMap | null)[]) {
    result.push(null, new HeightMapGap(this.length - from - 1))
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights): HeightMap {
    let end = offset + this.length
    if (measured && measured.from <= offset + this.length && measured.more) {
      // Fill in part of this gap with measured lines. We know there
      // can't be widgets or collapsed ranges in those lines, because
      // they would already have been added to the heightmap (gaps
      // only contain plain text).
      let nodes = [], pos = Math.max(offset, measured.from)
      if (measured.from > offset) nodes.push(new HeightMapGap(measured.from - offset - 1).updateHeight(oracle, offset))
      while (pos <= end && measured.more) {
        let len = oracle.doc.lineAt(pos).length
        if (nodes.length) nodes.push(null)
        let line = new HeightMapText(len, measured.heights[measured.index++])
        line.outdated = false
        nodes.push(line)
        pos += len + 1
      }
      if (pos <= end) nodes.push(null, new HeightMapGap(end - pos).updateHeight(oracle, pos))
      oracle.heightChanged = true
      return HeightMap.of(nodes)
    } else if (force || this.outdated) {
      this.setHeight(oracle, oracle.heightForGap(offset, offset + this.length))
      this.outdated = false
    }
    return this
  }

  toString() { return `gap(${this.length})` }
}

class HeightMapBranch extends HeightMap {
  size: number

  constructor(public left: HeightMap, brk: number, public right: HeightMap) {
    super(left.length + brk + right.length, left.height + right.height, brk | (left.outdated || right.outdated ? Flag.Outdated : 0))
    this.size = left.size + right.size
  }

  get break() { return this.flags & Flag.Break }

  blockAt(height: number, doc: Text, top: number, offset: number) {
    let mid = top + this.left.height
    return height < mid || this.right.height == 0 ? this.left.blockAt(height, doc, top, offset)
      : this.right.blockAt(height, doc, mid, offset + this.left.length + this.break)
  }

  lineAt(value: number, type: QueryType, doc: Text, top: number, offset: number) {
    let rightTop = top + this.left.height, rightOffset = offset + this.left.length + this.break
    let left = type == QueryType.ByHeight ? value < rightTop || this.right.height == 0 : value < rightOffset
    let base = left ? this.left.lineAt(value, type, doc, top, offset)
      : this.right.lineAt(value, type, doc, rightTop, rightOffset)
    if (this.break || (left ? base.to < rightOffset : base.from > rightOffset)) return base
    let subQuery = type == QueryType.ByPosNoHeight ? QueryType.ByPosNoHeight : QueryType.ByPos
    if (left)
      return base.join(this.right.lineAt(rightOffset, subQuery, doc, rightTop, rightOffset))
    else
      return this.left.lineAt(rightOffset, subQuery, doc, top, offset).join(base)
  }

  forEachLine(from: number, to: number, doc: Text, top: number, offset: number, f: (line: BlockInfo) => void) {
    let rightTop = top + this.left.height, rightOffset = offset + this.left.length + this.break
    if (this.break) {
      if (from < rightOffset) this.left.forEachLine(from, to, doc, top, offset, f)
      if (to >= rightOffset) this.right.forEachLine(from, to, doc, rightTop, rightOffset, f)
    } else {
      let mid = this.lineAt(rightOffset, QueryType.ByPos, doc, top, offset)
      if (from < mid.from) this.left.forEachLine(from, mid.from - 1, doc, top, offset, f)
      if (mid.to >= from && mid.from <= to) f(mid)
      if (to > mid.to) this.right.forEachLine(mid.to + 1, to, doc, rightTop, rightOffset, f)
    }
  }

  replace(from: number, to: number, nodes: (HeightMap | null)[]): HeightMap {
    let rightStart = this.left.length + this.break
    if (to < rightStart)
      return this.balanced(this.left.replace(from, to, nodes), this.right)
    if (from > this.left.length)
      return this.balanced(this.left, this.right.replace(from - rightStart, to - rightStart, nodes))

    let result: (HeightMap | null)[] = []
    if (from > 0) this.decomposeLeft(from, result)
    let left = result.length
    for (let node of nodes) result.push(node)
    if (from > 0) mergeGaps(result, left - 1)
    if (to < this.length) {
      let right = result.length
      this.decomposeRight(to, result)
      mergeGaps(result, right)
    }
    return HeightMap.of(result)
  }

  decomposeLeft(to: number, result: (HeightMap | null)[]) {
    let left = this.left.length
    if (to <= left) return this.left.decomposeLeft(to, result)
    result.push(this.left)
    if (this.break) {
      left++
      if (to >= left) result.push(null)
    }
    if (to > left) this.right.decomposeLeft(to - left, result)
  }

  decomposeRight(from: number, result: (HeightMap | null)[]) {
    let left = this.left.length, right = left + this.break
    if (from >= right) return this.right.decomposeRight(from - right, result)
    if (from < left) this.left.decomposeRight(from, result)
    if (this.break && from < right) result.push(null)
    result.push(this.right)
  }

  balanced(left: HeightMap, right: HeightMap): HeightMap {
    if (left.size > 2 * right.size || right.size > 2 * left.size)
      return HeightMap.of(this.break ? [left, null, right] : [left, right])
    this.left = left; this.right = right
    this.height = left.height + right.height
    this.outdated = left.outdated || right.outdated
    this.size = left.size + right.size
    this.length = left.length + this.break + right.length
    return this
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights): HeightMap {
    let {left, right} = this, rightStart = offset + left.length + this.break, rebalance: any = null
    if (measured && measured.from <= offset + left.length && measured.more)
      rebalance = left = left.updateHeight(oracle, offset, force, measured)
    else
      left.updateHeight(oracle, offset, force)
    if (measured && measured.from <= rightStart + right.length && measured.more)
      rebalance = right = right.updateHeight(oracle, rightStart, force, measured)
    else
      right.updateHeight(oracle, rightStart, force)
    if (rebalance) return this.balanced(left, right)
    this.height = this.left.height + this.right.height
    this.outdated = false
    return this
  }

  toString() { return this.left + (this.break ? " " : "-") + this.right }
}

function mergeGaps(nodes: (HeightMap | null)[], around: number) {
  let before, after
  if (nodes[around] == null &&
      (before = nodes[around - 1]) instanceof HeightMapGap &&
      (after = nodes[around + 1]) instanceof HeightMapGap)
    nodes.splice(around - 1, 3, new HeightMapGap(before.length + 1 + after.length))
}

const relevantWidgetHeight = 5

class NodeBuilder implements SpanIterator<Decoration> {
  nodes: (HeightMap | null)[] = []
  writtenTo: number
  lineStart = -1
  lineEnd = -1
  covering: HeightMapBlock | null = null

  constructor(public pos: number, public oracle: HeightOracle) {
    this.writtenTo = pos
  }

  get isCovered() {
    return this.covering && this.nodes[this.nodes.length - 1] == this.covering
  }

  span(_from: number, to: number) {
    if (this.lineStart > -1) {
      let end = Math.min(to, this.lineEnd), last = this.nodes[this.nodes.length - 1]
      if (last instanceof HeightMapText)
        last.length += end - this.pos
      else if (end > this.pos || !this.isCovered)
        this.nodes.push(new HeightMapText(end - this.pos, -1))
      this.writtenTo = end
      if (to > end) {
        this.nodes.push(null)
        this.writtenTo++
        this.lineStart = -1
      }
    }
    this.pos = to
  }

  point(from: number, to: number, deco: PointDecoration) {
    if (from < to || deco.heightRelevant) {
      let height = deco.widget ? Math.max(0, deco.widget.estimatedHeight) : 0
      let len = to - from
      if (deco.block) {
        this.addBlock(new HeightMapBlock(len, height, deco.type))
      } else if (len || height >= relevantWidgetHeight) {
        this.addLineDeco(height, len)
      }
    } else if (to > from) {
      this.span(from, to)
    }
    if (this.lineEnd > -1 && this.lineEnd < this.pos)
      this.lineEnd = this.oracle.doc.lineAt(this.pos).to
  }

  enterLine() {
    if (this.lineStart > -1) return
    let {from, to} = this.oracle.doc.lineAt(this.pos)
    this.lineStart = from; this.lineEnd = to
    if (this.writtenTo < from) {
      if (this.writtenTo < from - 1 || this.nodes[this.nodes.length - 1] == null)
        this.nodes.push(this.blankContent(this.writtenTo, from - 1))
      this.nodes.push(null)
    }
    if (this.pos > from)
      this.nodes.push(new HeightMapText(this.pos - from, -1))
    this.writtenTo = this.pos
  }

  blankContent(from: number, to: number) {
    let gap = new HeightMapGap(to - from)
    if (this.oracle.doc.lineAt(from).to == to) gap.flags |= Flag.SingleLine
    return gap
  }

  ensureLine() {
    this.enterLine()
    let last = this.nodes.length ? this.nodes[this.nodes.length - 1] : null
    if (last instanceof HeightMapText) return last
    let line = new HeightMapText(0, -1)
    this.nodes.push(line)
    return line
  }

  addBlock(block: HeightMapBlock) {
    this.enterLine()
    if (block.type == BlockType.WidgetAfter && !this.isCovered) this.ensureLine()
    this.nodes.push(block)
    this.writtenTo = this.pos = this.pos + block.length
    if (block.type != BlockType.WidgetBefore) this.covering = block
  }

  addLineDeco(height: number, length: number) {
    let line = this.ensureLine()
    line.length += length
    line.collapsed += length
    line.widgetHeight = Math.max(line.widgetHeight, height)
    this.writtenTo = this.pos = this.pos + length
  }

  finish(from: number) {
    let last = this.nodes.length == 0 ? null : this.nodes[this.nodes.length - 1]
    if (this.lineStart > -1 && !(last instanceof HeightMapText) && !this.isCovered)
      this.nodes.push(new HeightMapText(0, -1))
    else if (this.writtenTo < this.pos || last == null)
      this.nodes.push(this.blankContent(this.writtenTo, this.pos))
    let pos = from
    for (let node of this.nodes) {
      if (node instanceof HeightMapText) node.updateHeight(this.oracle, pos)
      pos += node ? node.length : 1
    }
    return this.nodes
  }

  // Always called with a region that on both sides either stretches
  // to a line break or the end of the document.
  // The returned array uses null to indicate line breaks, but never
  // starts or ends in a line break, or has multiple line breaks next
  // to each other.
  static build(oracle: HeightOracle, decorations: readonly DecorationSet[],
               from: number, to: number): (HeightMap | null)[] {
    let builder = new NodeBuilder(from, oracle)
    RangeSet.spans(decorations, from, to, builder)
    return builder.finish(from)
  }

  get minPointSize() { return 0 }
}

export function heightRelevantDecoChanges(a: readonly DecorationSet[], b: readonly DecorationSet[], diff: ChangeSet) {
  let comp = new DecorationComparator()
  RangeSet.compare(a, b, diff, comp)
  return comp.changes
}

class DecorationComparator {
  changes: number[] = []

  compareRange() {}

  comparePoint(from: number, to: number, a: Decoration | null, b: Decoration | null) {
    if (from < to || a && a.heightRelevant || b && b.heightRelevant) addRange(from, to, this.changes)
  }

  get minPointSize() { return 0 }
}
