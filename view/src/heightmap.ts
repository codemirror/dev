import {Text} from "../../doc/src"
import {ChangedRange} from "../../state/src"
import {RangeSet, RangeIterator, RangeValue} from "../../rangeset/src/rangeset"
import {DecorationSet, ReplaceDecoration, WidgetDecoration, Decoration} from "./decoration"
import {Viewport} from "./viewport"

const wrappingWhiteSpace = ["pre-wrap", "normal", "pre-line"]

export class HeightOracle {
  doc: Text = Text.of([""])
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
              readonly top: number, readonly height: number,
              // @internal
              readonly line: HeightMapLine | null) {}

  get bottom() { return this.top + this.height }
  get textTop() { return this.top + (this.line ? startWidgetHeight(this.line.deco) : 0) }
  get textBottom() { return this.bottom - (this.line ? endWidgetHeight(this.line.deco, this.line.length) : 0) }
  get hasReplacedRanges() {
    return this.line ? this.line.deco.some(d => d.length > 0) : false
  }
}

export abstract class HeightMap {
  constructor(
    public length: number, // The number of characters covered
    public height: number, // Height of this part of the document
    public outdated: boolean = true
  ) {}

  size!: number

  abstract heightAt(pos: number, doc: Text, bias?: -1 | 1, offset?: number): number
  abstract lineAt(height: number, doc: Text, offset?: number): LineHeight
  abstract lineViewport(pos: number, doc: Text, offset?: number): Viewport
  abstract decomposeLeft(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newTo: number): void
  abstract decomposeRight(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newFrom: number): void
  abstract updateHeight(oracle: HeightOracle, offset?: number, force?: boolean, measured?: MeasuredHeights): HeightMap
  abstract toString(): void
  abstract forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void): void

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
    let me: HeightMap = this, off = 0
    for (let i = 0; i < changes.length; i++) {
      let range = changes[i]
      let nodes = buildChangedNodes(oracle, decorations, range.fromB, range.toB)
      me = me.replace(range.fromA + off, range.toA + off, nodes, oracle, range.fromB, range.toB)
      off += range.lenDiff
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

HeightMap.prototype.size = 1

const enum DecoType { inline, before, after, range }

class DecoDesc {
  constructor(public pos: number,
              public type: DecoType,
              public height: number,
              public length: number = 0) {}

  move(offset: number) {
    return new DecoDesc(this.pos + offset, this.type, this.height, this.length)
  }

  setHeight(height: number) {
    return new DecoDesc(this.pos, this.type, height, this.length)
  }

  toString() {
    return {[DecoType.inline]: "", [DecoType.before]: "B", [DecoType.after]: "A", [DecoType.range]: "R"}[this.type] +
      this.pos + (this.length ? "-" + (this.pos + this.length) : "")
  }
}

const noDeco: DecoDesc[] = []

class HeightMapLine extends HeightMap {
  // Decoration information is stored in a somewhat obscure format—the
  // array of numbers in `deco` encodes all of collapsed ranges,
  // inline widgets, and widgets above/below the line.
  //
  // These are the pieces of information that need to be stored about
  // lines to somewhat effectively estimate their height when they are
  // not actually in view and thus can not be measured. Widget size
  // above/below is also necessary in heightAt, to skip it.
  constructor(length: number, height: number, public deco: DecoDesc[] = noDeco) { super(length, height) }

  heightAt(pos: number, doc: Text, bias: 1 | -1): number {
    return bias < 0 ? startWidgetHeight(this.deco) : this.height - endWidgetHeight(this.deco, this.length)
  }

  lineAt(height: number, doc: Text, offset: number = 0) {
    return new LineHeight(offset, offset + this.length, -height, this.height, this)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    return new Viewport(offset, offset + this.length)
  }

  replace(from: number, to: number, nodes: HeightMap[], oracle: HeightOracle, newFrom: number, newTo: number): HeightMap {
    if (nodes.length != 1 || (nodes[0] instanceof HeightMapGap && oracle.doc.lineAt(newFrom).end < newTo))
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
      let nextEnd = oracle.doc.lineAt(newTo).end, breakInside = nextEnd < newTo + node.length
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
      let prevStart = oracle.doc.lineAt(newFrom).start, breakInside = prevStart > newFrom - node.length
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

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights) {
    if (measured && measured.from <= offset && measured.more) {
      let total = 0, updated = false
      this.iterBlocks((from, to, deco, i) => {
      // There'll be a measurement for each piece of text and each
      // block widget in this line
        let height = measured.heights[measured.index++]
        if (deco && deco.height != height) {
          if (!updated) { this.deco = this.deco.slice(); updated = true }
          oracle.heightChanged = true
          this.deco[i] = deco.setHeight(height)
        }
        total += height
      })
      this.setHeight(oracle, total)
    } else if (force || this.outdated) {
      let total = 0
      this.iterBlocks((from, to, deco, startI, endI) => {
        if (deco) {
          total += deco.height
        } else {
          let min = 0, len = to - from
          for (let i = startI; i < endI; i++) {
            min = Math.max(min, this.deco[i].height)
            len -= this.deco[i].length
          }
          total += Math.max(min, oracle.heightForLine(len))
        }
      })
      this.setHeight(oracle, total)
    }
    this.outdated = false
    return this
  }

  iterBlocks(f: (from: number, to: number, deco: DecoDesc | null, startI: number, endI: number) => void) {
    for (let i = 0, start = 0, covered = false, len = this.deco.length;; i++) {
      let startI = i
      while (i < len && this.deco[i].type == DecoType.inline) i++
      let end = i == len ? this.length : this.deco[i].pos
      // Stretch of text
      if (end > start || (!covered && (i == len || this.deco[i].type == DecoType.after)))
        f(start, end, null, startI, i)
      if (i == len) break
      let deco = this.deco[i]
      f(end, start = end + deco.length, deco, i, i + 1)
      covered = deco.type != DecoType.before
    }
  }

  toString() { return `line(${this.length}${this.deco.length ? ":" + this.deco.join(",") : ""})` }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void) {
    f(new LineHeight(offset, offset + this.length, 0, this.height, this))
  }
}

function offsetDeco(deco: DecoDesc[], from: number, to: number, length: number): DecoDesc[] {
  let result: DecoDesc[] | null = null
  let off = length - (to - from)
  for (let i = 0; i < deco.length; i++) {
    let d = deco[i]
    if (d.pos < from || d.pos > to && off == 0) continue
    if (!result) result = deco.slice(0, i)
    if (d.pos > to) result.push(d.move(off))
  }
  return !result ? deco : result.length ? result : noDeco
}

function insertDeco(deco: DecoDesc[], newDeco: DecoDesc[], pos: number): DecoDesc[] {
  if (newDeco.length == 0) return deco
  let result = [], inserted = false
  for (let i = 0;; i++) {
    let next = i == deco.length ? 2e9 : deco[i].pos
    if (!inserted && next > pos) {
      for (let j = 0; j < newDeco.length; j++) result.push(newDeco[j])
      inserted = true
    }
    if (next == 2e9) return result
    result.push(deco[i])
  }
}

function startWidgetHeight(deco: ReadonlyArray<DecoDesc>): number {
  let height = 0, pos = 0
  for (let d of deco) {
    if (d.pos > pos || (d.type != DecoType.range && d.type != DecoType.before)) break
    height += d.height
    pos = d.pos + d.length
  }
  return height
}

function endWidgetHeight(deco: ReadonlyArray<DecoDesc>, length: number): number {
  let height = 0, pos = length
  for (let i = deco.length - 1; i >= 0; i--) {
    let d = deco[i]
    if (d.pos + d.length < pos || (d.type != DecoType.range && d.type != DecoType.after)) break
    height += d.height
    pos = d.pos
  }
  return pos == 0 ? height - startWidgetHeight(deco) : height
}

class HeightMapGap extends HeightMap {
  constructor(from: number, to: number, oracle: HeightOracle) {
    super(to - from, oracle.heightForGap(from, to), false)
  }

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
    return new LineHeight(start, end, top, heightPerLine, null)
  }

  lineViewport(pos: number, doc: Text, offset: number = 0): Viewport {
    let {start, end} = doc.lineAt(pos + offset)
    return new Viewport(start, end)
  }

  replace(from: number, to: number, nodes: HeightMap[], oracle: HeightOracle, newFrom: number, newTo: number): HeightMap {
    if (nodes.length != 1 || !(nodes[0] instanceof HeightMapGap))
      return super.replace(from, to, nodes, oracle, newFrom, newTo)
    this.length += (newTo - newFrom) - (to - from)
    let newStart = newFrom - from
    // FIXME the Math.min is a kludge to deal with the fact that, if
    // there are further changes that'll be applied by applyChanges,
    // the estimated length here may extend past the end of the document
    this.setHeight(oracle, oracle.heightForGap(newStart, Math.min(oracle.doc.length, newStart + this.length)))
    return this
  }

  decomposeLeft(to: number, target: HeightMap[], node: HeightMap, oracle: HeightOracle, newTo: number) {
    let newOffset = newTo - to
    if (node instanceof HeightMapGap) {
      target.push(new HeightMapGap(newOffset, newTo + node.length, oracle))
    } else {
      let lineStart = oracle.doc.lineAt(newTo).start
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
      let lineEnd = oracle.doc.lineAt(newFrom).end
      target.push(new HeightMapLine(node.length + (lineEnd - newFrom), node.height, (node as HeightMapLine).deco))
      if (newEnd > lineEnd) target.push(new HeightMapGap(lineEnd + 1, newEnd, oracle))
    }
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights): HeightMap {
    let end = offset + this.length
    if (measured && measured.from <= offset + this.length && measured.more) {
      // Fill in part of this gap with measured lines. We know there
      // can't be widgets or collapsed ranges in those lines, because
      // they would already have been added to the heightmap (gaps
      // only contain plain text).
      let nodes = [], pos = Math.max(offset, measured.from)
      if (measured.from > offset) nodes.push(new HeightMapGap(offset, measured.from - 1, oracle))
      while (pos <= end && measured.more) {
        let len = oracle.doc.lineAt(pos).length
        nodes.push(new HeightMapLine(len, measured.heights[measured.index++]))
        pos += len + 1
      }
      if (pos < end) nodes.push(new HeightMapGap(pos, end, oracle))
      for (let node of nodes) node.outdated = false
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
      f(new LineHeight(pos, end, 0, oracle.heightForLine(end - pos), null))
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

  lineAt(height: number, doc: Text, offset: number = 0) {
    let right = height - this.left.height
    if (right < 0) return this.left.lineAt(height, doc, offset)
    return this.right.lineAt(right, doc, offset + this.left.length + 1)
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

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights): HeightMap {
    let {left, right} = this, rightStart = offset + left.length + 1, rebalance: any = null
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

  toString() { return this.left + " " + this.right }

  forEachLine(from: number, to: number, offset: number, oracle: HeightOracle, f: (height: LineHeight) => void) {
    let rightStart = offset + this.left.length + 1
    if (from < rightStart) this.left.forEachLine(from, to, offset, oracle, f)
    if (to >= rightStart) this.right.forEachLine(from, to, rightStart, oracle, f)
  }
}

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
      if (this.lineEnd < 0) this.lineEnd = this.oracle.doc.lineAt(this.pos).end
      if (pos > this.lineEnd) {
        this.curLine.length += this.lineEnd - this.pos
        this.curLine.updateHeight(this.oracle, this.lineEnd - this.curLine.length)
        this.curLine = null
        this.writtenTo = this.lineEnd + 1
        this.lineEnd = -1
      } else {
        this.curLine.length += pos - this.pos
        this.writtenTo = pos
      }
    } else if (this.lineEnd > -1 && pos > this.lineEnd) {
      this.lineEnd = -1
    }
    this.pos = pos
  }

  advanceReplaced(pos: number, deco: ReplaceDecoration) {
    let type = deco.block ? DecoType.range : DecoType.inline
    this.addDeco(this.pos, type, deco.widget ? Math.max(deco.widget.estimatedHeight, 0) : 0, pos)
    this.curLine!.length += pos - this.pos
    if (this.lineEnd < pos) this.lineEnd = -1
    this.writtenTo = this.pos = pos
  }

  point(deco: WidgetDecoration) {
    let type = !deco.block ? DecoType.inline : deco.startSide > 0 ? DecoType.after : DecoType.before
    this.addDeco(this.pos, type, deco.widget ? Math.max(0, deco.widget.estimatedHeight) : 0)
  }

  flushTo(pos: number) {
    if (pos > this.writtenTo) {
      this.nodes.push(new HeightMapGap(this.writtenTo, pos, this.oracle))
      this.writtenTo = pos
    }
  }

  addDeco(pos: number, type: DecoType, height: number, end = pos) {
    if (!this.curLine) {
      this.lineStart = Math.max(this.writtenTo, this.oracle.doc.lineAt(this.pos).start)
      this.flushTo(this.lineStart - 1)
      this.nodes.push(this.curLine = new HeightMapLine(this.pos - this.lineStart, 0, []))
      this.writtenTo = this.pos
    }
    this.curLine.deco.push(new DecoDesc(pos - this.lineStart, type, height, end - pos))
  }

  ignoreRange(value: Decoration) { return !(value as RangeValue).replace }
  ignorePoint(value: WidgetDecoration) { return !(value.block || value.widget && value.widget.estimatedHeight > 0) }
}

function buildChangedNodes(oracle: HeightOracle, decorations: ReadonlyArray<DecorationSet>, from: number, to: number): HeightMap[] {
  let builder = new NodeBuilder(from, oracle)
  RangeSet.iterateSpans(decorations, from, to, builder)
  if (builder.curLine) builder.curLine.updateHeight(oracle, builder.pos - builder.curLine.length)
  else builder.flushTo(builder.pos)
  if (builder.nodes.length == 0) builder.nodes.push(new HeightMapGap(0, 0, oracle))
  return builder.nodes
}
