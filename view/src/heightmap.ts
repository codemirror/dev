import {Text} from "../../doc/src"
import {ChangedRange} from "../../state/src"
import {RangeSet, RangeIterator, RangeValue} from "../../rangeset/src/rangeset"
import {DecorationSet, ReplaceDecoration, WidgetDecoration, Decoration} from "./decoration"
import {Viewport} from "./viewport"

const wrappingWhiteSpace = ["pre-wrap", "normal", "pre-line"]

export class HeightOracle {
  doc: Text = Text.empty
  lineWrapping: boolean = false
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

  mustRefresh(lineHeights: number[]): boolean {
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
    return newHeight
  }

  refresh(whiteSpace: string, lineHeight: number, charWidth: number, lineLength: number, knownHeights: number[]): boolean {
    let lineWrapping = wrappingWhiteSpace.indexOf(whiteSpace) > -1
    let changed = Math.round(lineHeight) != Math.round(this.lineHeight) || this.lineWrapping != lineWrapping
    this.lineWrapping = lineWrapping
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
// arrive at the right lines. The `heights` array is a sequence of
// line heights, starting from position `from`. When the lines have
// line widgets, their height may be followed by a -1 or -2
// (indicating whether the height is below or above the line) and then
// a total widget height.
export class MeasuredHeights {
  public index = 0
  constructor(readonly from: number, readonly heights: number[]) {}
  get more() { return this.index < this.heights.length }
}

export class LineHeight {
  constructor(readonly start: number, readonly end: number,
              readonly top: number, readonly height: number) {}

  get bottom() { return this.top + this.height }
  get textTop() { return this.top } // FIXME remove
  get textBottom() { return this.bottom }
  get hasReplacedRanges() { return false } // FIXME no longer meaningful
}

const enum Flag { break = 1, outdated = 2 }

export abstract class HeightMap {
  constructor(
    public length: number, // The number of characters covered
    public height: number, // Height of this part of the document
    public flags: number = Flag.outdated
  ) {}

  size!: number

  get outdated() { return (this.flags & Flag.outdated) > 0 }
  set outdated(value) { this.flags = value ? this.flags | Flag.outdated : this.flags & ~Flag.outdated }

  abstract heightAt(pos: number, doc: Text, bias?: -1 | 1, offset?: number): number
  abstract lineAt(height: number, doc: Text, offset?: number): LineHeight
  abstract lineViewport(pos: number, doc: Text, offset?: number): Viewport
  abstract updateHeight(oracle: HeightOracle, offset?: number, force?: boolean, measured?: MeasuredHeights): HeightMap
  abstract toString(): void
  // FIXME needs a different protocol
  abstract forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void): void

  setHeight(oracle: HeightOracle, height: number) {
    if (this.height != height) {
      this.height = height
      oracle.heightChanged = true
    }
  }

  // Base case is to replace a leaf node, which simply builds a tree
  // from the new nodes and returns that (HeightMapBranch and
  // HeightMapGap override this to actually use from/to)
  replace(from: number, to: number, nodes: (HeightMap | null)[]): HeightMap {
    return HeightMap.of(nodes)
  }

  // Again, these are base cases, and are overridden for branch and gap nodes.
  decomposeLeft(to: number, result: (HeightMap | null)[]) { result.push(this) }
  decomposeRight(from: number, result: (HeightMap | null)[]) { result.push(this) }

  applyChanges(decorations: ReadonlyArray<DecorationSet>, oldDoc: Text, oracle: HeightOracle,
               changes: ReadonlyArray<ChangedRange>): HeightMap {
    let me: HeightMap = this
    for (let i = changes.length - 1; i >= 0; i--) {
      let {fromA, toA, fromB, toB} = changes[i]
      let start = me.lineViewport(fromA, oldDoc), end = start.to >= toA ? start : me.lineViewport(toA, oldDoc)
      toB += end.to - toA; toA = end.to
      while (i > 0 && start.from <= changes[i - 1].toA) {
        fromA = changes[i - 1].fromA
        fromB = changes[i - 1].fromB
        i--
        if (fromA < start.from) start = me.lineViewport(fromA, oldDoc)
      }
      fromB += start.from - fromA; fromA = start.from
      let nodes = NodeBuilder.build(oracle, decorations, fromB, toB)
      me = me.replace(fromA, toA, nodes)
    }
    return me.updateHeight(oracle, 0)
  }

  static empty() { return new HeightMapLine(0, 0) }

  // nodes uses null values to indicate the position of line breaks.
  // There are never line breaks at the start or end of the array, or
  // two line breaks next to each other.
  static of(nodes: (HeightMap | null)[]): HeightMap {
    if (nodes.length == 1) return nodes[0] as HeightMap

    let i = 0, j = nodes.length, before = 0, after = 0
    while (i < j) {
      if (before < after) {
        let next = nodes[i++]
        if (next) before += next.size
      } else {
        let next = nodes[--j]
        if (next) after += next.size
      }
    }
    for (;;) {
      if (before > after * 2) {
        let {left, break: brk, right} = nodes[i - 1] as HeightMapBranch
        if (brk) nodes.splice(i - 1, 1, left, null, right)
        else nodes.splice(i - 1, 1, left, right)
        before -= right.size
        after += right.size
      } else if (after > before * 2) {
        let {left, break: brk, right} = nodes[i] as HeightMapBranch
        if (brk) nodes.splice(i++, 1, left, null, right)
        else nodes.splice(i++, 1, left, right)
        j++
        after -= left.size
        before += left.size
      } else {
        break
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
  heightAt(pos: number, doc: Text, bias: 1 | -1): number {
    return bias < 0 ? 0 : this.height
  }

  lineAt(height: number, doc: Text, offset: number = 0) {
    return new LineHeight(offset, offset + this.length, -height, this.height)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    return new Viewport(offset, offset + this.length)
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights) {
    if (measured && measured.from <= offset && measured.more)
      this.setHeight(oracle, measured.heights[measured.index++])
    this.outdated = false
    return this
  }

  toString() { return `block(${this.length})` }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void) {}
}

class HeightMapLine extends HeightMapBlock {
  public collapsed = 0 // Amount of collapsed content in the line
  public widgetHeight = 0 // Maximum inline widget height

  // Decoration information is stored in a somewhat obscure format—the
  // array of numbers in `deco` encodes all of collapsed ranges,
  // inline widgets, and widgets above/below the line.
  //
  // These are the pieces of information that need to be stored about
  // lines to somewhat effectively estimate their height when they are
  // not actually in view and thus can not be measured. Widget size
  // above/below is also necessary in heightAt, to skip it.
  constructor(length: number, height: number) { super(length, height) }

  replace(from: number, to: number, nodes: (HeightMap | null)[]): HeightMap {
    if (nodes.length == 1 && nodes[0] instanceof HeightMapLine && Math.abs(this.length - nodes[0]!.length) < 10) {
      nodes[0]!.height = this.height
      return nodes[0]!
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

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void) {
    f(new LineHeight(offset, offset + this.length, 0, this.height))
  }
}

class HeightMapGap extends HeightMap {
  constructor(length: number) { super(length, 0) }

  heightAt(pos: number, doc: Text, bias: 1 | -1, offset: number = 0) {
    let firstLine = doc.lineAt(offset).number, lastLine = doc.lineAt(offset + this.length).number
    let lines = lastLine - firstLine + 1
    return (doc.lineAt(pos).number - firstLine + (bias > 0 ? 1 : 0)) * (this.height / lines)
  }

  lineAt(height: number, doc: Text, offset: number = 0) {
    let firstLine = doc.lineAt(offset).number, lastLine = doc.lineAt(offset + this.length).number
    let lines = lastLine - firstLine, line = Math.floor(lines * Math.max(0, Math.min(1, height / this.height)))
    let heightPerLine = this.height / (lines + 1), top = heightPerLine * line - height
    let {start, end} = doc.line(firstLine + line)
    return new LineHeight(start, end, top, heightPerLine)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    let {start, end} = doc.lineAt(pos + offset)
    return new Viewport(start, end)
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
    result.push(to == this.length ? this : new HeightMapGap(to))
  }

  decomposeRight(from: number, result: (HeightMap | null)[]) {
    result.push(from == 0 ? this : new HeightMapGap(this.length - from))
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
        let line = new HeightMapLine(len, measured.heights[measured.index++])
        line.outdated = false
        nodes.push(line)
        pos += len + 1
      }
      if (pos < end) nodes.push(null, new HeightMapGap(end - pos).updateHeight(oracle, pos))
      oracle.heightChanged = true
      return HeightMap.of(nodes)
    } else if (force || this.outdated) {
      this.setHeight(oracle, oracle.heightForGap(offset, offset + this.length))
      this.outdated = false
    }
    return this
  }

  toString() { return `gap(${this.length})` }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void) {
    for (let pos = Math.max(from, offset), end = Math.min(to, offset + this.length); pos <= end;) {
      let end = oracle.doc.lineAt(pos).end
      f(new LineHeight(pos, end, 0, oracle.heightForLine(end - pos)))
      pos = end + 1
    }
  }
}

class HeightMapBranch extends HeightMap {
  size: number

  constructor(public left: HeightMap, brk: number, public right: HeightMap) {
    super(left.length + brk + right.length, left.height + right.height, brk | (left.outdated || right.outdated ? Flag.outdated : 0))
    this.size = left.size + right.size
  }

  get break() { return this.flags & Flag.break }
  set break(value: number) { this.flags = value ? this.flags | Flag.break : this.flags & ~Flag.break }

  // FIXME boundary conditions when there's no break

  heightAt(pos: number, doc: Text, bias: 1 | -1, offset: number = 0): number {
    let rightStart = offset + this.left.length + this.break
    return pos < rightStart ? this.left.heightAt(pos, doc, bias, offset)
      : this.left.height + this.right.heightAt(pos, doc, bias, rightStart)
  }

  lineAt(height: number, doc: Text, offset: number = 0) {
    let right = height - this.left.height
    if (right < 0) return this.left.lineAt(height, doc, offset)
    return this.right.lineAt(right, doc, offset + this.left.length + this.break)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    let rightStart = this.left.length + this.break
    return pos < rightStart ? this.left.lineViewport(pos, doc, offset)
      : this.right.lineViewport(pos - rightStart, doc, offset + rightStart)
  }

  replace(from: number, to: number, nodes: (HeightMap | null)[]): HeightMap {
    let rightStart = this.left.length + this.break
    if (to <= rightStart)
      return this.balanced(this.left.replace(from, to, nodes), this.break, this.right)
    if (from >= rightStart)
      return this.balanced(this.left, this.break, this.right.replace(from - rightStart, to - rightStart, nodes))

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

  balanced(left: HeightMap, brk: number, right: HeightMap): HeightMap {
    if (left.size > 2 * right.size || right.size > 2 * left.size)
      return HeightMap.of(brk ? [left, null, right] : [left, right])
    this.left = left; this.right = right; this.break = brk
    this.height = left.height + right.height
    this.outdated = left.outdated || right.outdated
    this.size = left.size + right.size
    this.length = left.length + brk + right.length
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
    if (rebalance) return this.balanced(left, this.break, right)
    this.height = this.left.height + this.right.height
    this.outdated = false
    return this
  }

  toString() { return this.left + (this.break ? " " : "-") + this.right }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void) {
    let rightStart = offset + this.left.length + this.break
    if (from < rightStart) this.left.forEachLine(from, to, offset, oracle, f)
    if (to >= rightStart) this.right.forEachLine(from, to, rightStart, oracle, f)
  }
}

function mergeGaps(nodes: (HeightMap | null)[], around: number) {
  let before, after
  if (nodes[around] == null &&
      (before = nodes[around - 1]) instanceof HeightMapGap &&
      (after = nodes[around + 1]) instanceof HeightMapGap)
    nodes.splice(around - 1, 3, new HeightMapGap(before.length + 1 + after.length))
}

const relevantWidgetHeight = 5

class NodeBuilder implements RangeIterator<Decoration> {
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

  advance(pos: number) {
    if (pos <= this.pos) return
    if (this.lineStart > -1) {
      let end = Math.min(pos, this.lineEnd), last = this.nodes[this.nodes.length - 1]
      if (last instanceof HeightMapLine)
        last.length += end - this.pos
      else if (end > this.pos || !this.isCovered)
        this.nodes.push(new HeightMapLine(end - this.pos, -1))
      this.writtenTo = end
      if (pos > end) {
        this.nodes.push(null)
        this.writtenTo++
        this.lineStart = -1
      }
    }
    this.pos = pos
  }

  advanceReplaced(pos: number, deco: ReplaceDecoration) {
    let height = deco.widget ? Math.max(0, deco.widget.estimatedHeight) : 0
    if (deco.block)
      this.addBlock(new HeightMapBlock(pos - this.pos, height), true, true)
    else if (pos > this.pos || height >= relevantWidgetHeight)
      this.addLineDeco(height, pos - this.pos)
    if (this.lineEnd > -1 && this.lineEnd < this.pos)
      this.lineEnd = this.oracle.doc.lineAt(this.pos).end
  }

  point(deco: WidgetDecoration) {
    let height = deco.widget ? Math.max(0, deco.widget.estimatedHeight) : 0
    if (deco.block)
      this.addBlock(new HeightMapBlock(0, height), deco.startSide < 0, deco.startSide > 0)
    else if (height >= relevantWidgetHeight)
      this.addLineDeco(height, 0)
  }

  enterLine() {
    if (this.lineStart > -1) return
    let {start, end} = this.oracle.doc.lineAt(this.pos)
    this.lineStart = start; this.lineEnd = end
    if (this.writtenTo < start) {
      if (this.writtenTo < start - 1 || this.nodes[this.nodes.length - 1] == null)
        this.nodes.push(new HeightMapGap(start - this.writtenTo - 1))
      this.nodes.push(null)
    }
    if (this.pos > start)
      this.nodes.push(new HeightMapLine(this.pos - start, -1))
    this.writtenTo = this.pos
  }

  ensureLine() {
    this.enterLine()
    let last = this.nodes.length ? this.nodes[this.nodes.length - 1] : null
    if (last instanceof HeightMapLine) return last
    let line = new HeightMapLine(0, -1)
    this.nodes.push(line)
    return line
  }

  addBlock(block: HeightMapBlock, coverStart: boolean, coverEnd: boolean) {
    this.enterLine()
    if (!coverStart && !this.isCovered) this.ensureLine()
    this.nodes.push(block)
    this.writtenTo = this.pos = this.pos + block.length
    if (coverEnd) this.covering = block
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
    if (this.lineStart > -1 && !(last instanceof HeightMapLine) && !this.isCovered)
      this.nodes.push(new HeightMapLine(0, -1))
    else if (this.writtenTo < this.pos || last == null)
      this.nodes.push(new HeightMapGap(this.pos - this.writtenTo))
    let pos = from
    for (let node of this.nodes) {
      if (node instanceof HeightMapLine) node.updateHeight(this.oracle, pos)
      pos += node ? node.length : 1
    }
    return this.nodes
  }

  ignoreRange(value: Decoration) { return !(value as RangeValue).replace }
  ignorePoint(value: WidgetDecoration) { return !(value.block || value.widget && value.widget.estimatedHeight > 0) }

  // Always called with a region that on both sides either stretches
  // to a line break or the end of the document.
  // The returned array uses null to indicate line breaks, but never
  // starts or ends in a line break, or has multiple line breaks next
  // to each other.
  static build(oracle: HeightOracle, decorations: ReadonlyArray<DecorationSet>,
               from: number, to: number): (HeightMap | null)[] {
    let builder = new NodeBuilder(from, oracle)
    RangeSet.iterateSpans(decorations, from, to, builder)
    return builder.finish(from)
  }
}
