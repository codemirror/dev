const enum Tree {
  // The branch factor as an exponent of 2
  BranchShift = 5,
  // The approximate branch factor of the tree (both in leaf and
  // branch nodes)
  Branch = 1 << Tree.BranchShift
}

// Flags passed to decompose
const enum Open { From = 1, To = 2 }

/// A text iterator iterates over a sequence of strings. When
/// iterating over a [`Text`](#text.Text) document, result values will
/// either be lines or line breaks.
export interface TextIterator extends Iterator<string> {
  /// Retrieve the next string. Optionally skip a given number of
  /// positions after the current position. Always returns the object
  /// itself.
  next(skip?: number): this
  /// The current string. Will be the empty string when the cursor is
  /// at its end or `next` hasn't been called on it yet.
  value: string
  /// Whether the end of the iteration has been reached. You should
  /// probably check this right after calling `next`.
  done: boolean
  /// Whether the current string represents a line break.
  lineBreak: boolean
}

/// The data structure for documents.
export abstract class Text implements Iterable<string> {
  /// The length of the string.
  abstract readonly length: number
  /// The number of lines in the string (always >= 1).
  abstract readonly lines: number
  /// @internal
  abstract readonly children: readonly Text[] | null

  [Symbol.iterator]!: () => Iterator<string>

  /// Get the line description around the given position.
  lineAt(pos: number): Line {
    if (pos < 0 || pos > this.length)
      throw new RangeError(`Invalid position ${pos} in document of length ${this.length}`)
    return this.lineInner(pos, false, 1, 0)
  }

  /// Get the description for the given (1-based) line number.
  line(n: number): Line {
    if (n < 1 || n > this.lines) throw new RangeError(`Invalid line number ${n} in ${this.lines}-line document`)
    return this.lineInner(n, true, 1, 0)
  }

  /// @internal
  abstract lineInner(target: number, isLine: boolean, line: number, offset: number): Line

  /// Replace a range of the text with the given content.
  replace(from: number, to: number, text: Text): Text {
    let parts: Text[] = []
    if (from) this.decompose(0, from, parts, Open.To)
    if (text.length) text.decompose(0, text.length, parts, (from ? Open.From : 0) | (to < this.length ? Open.To : 0))
    if (to < this.length) this.decompose(to, this.length, parts, parts.length ? Open.From : 0)
    return TextNode.from(parts, this.length - (to - from) + text.length)
  }

  /// Append another document to this one.
  append(other: Text) {
    return this.replace(this.length, this.length, other)
  }

  /// Retrieve the text between the given points.
  slice(from: number, to: number = this.length): Text {
    let parts: Text[] = []
    this.decompose(from, to, parts, 0)
    return TextNode.from(parts, to - from)
  }

  /// Retrive a part of the document as a string
  abstract sliceString(from: number, to?: number, lineSep?: string): string

  /// @internal
  abstract flatten(target: string[]): void

  /// Test whether this text is equal to another instance.
  eq(other: Text): boolean {
    if (other == this) return true
    if (other.length != this.length || other.lines != this.lines) return false
    let a = new RawTextCursor(this), b = new RawTextCursor(other)
    for (;;) {
      a.next()
      b.next()
      if (a.lineBreak != b.lineBreak || a.done != b.done || a.value != b.value) return false
      if (a.done) return true
    }
  }

  /// Iterate over the text. When `dir` is `-1`, iteration happens
  /// from end to start. This will return lines and the breaks between
  /// them as separate strings, and for long lines, might split lines
  /// themselves into multiple chunks as well.
  iter(dir: 1 | -1 = 1): TextIterator { return new RawTextCursor(this, dir) }

  /// Iterate over a range of the text. When `from` > `to`, the
  /// iterator will run in reverse.
  iterRange(from: number, to: number = this.length): TextIterator { return new PartialTextCursor(this, from, to) }

  /// @internal
  abstract decompose(from: number, to: number, target: Text[], open: Open): void

  /// @internal
  toString() { return this.sliceString(0) }

  /// Convert the document to an array of lines (which can be
  /// deserialized again via [`Text.of`](#text.Text^of)).
  toJSON() {
    let lines: string[] = []
    this.flatten(lines)
    return lines
  }

  /// @internal
  protected constructor() {}

  /// Create a `Text` instance for the given array of lines.
  static of(text: readonly string[]): Text {
    if (text.length == 0) throw new RangeError("A document must have at least one line")
    if (text.length == 1 && !text[0]) return Text.empty
    return text.length <= Tree.Branch ? new TextLeaf(text) : TextNode.from(TextLeaf.split(text, []))
  }

  /// The empty document.
  static empty: Text
}

if (typeof Symbol != "undefined")
  Text.prototype[Symbol.iterator] = function() { return this.iter() }

// Leaves store an array of line strings. There are always line breaks
// between these strings. Leaves are limited in size and have to be
// contained in TextNode instances for bigger documents.
class TextLeaf extends Text {
  constructor(readonly text: readonly string[], readonly length: number = textLength(text)) {
    super()
  }

  get lines(): number { return this.text.length }

  get children() { return null }

  lineInner(target: number, isLine: boolean, line: number, offset: number): Line {
    for (let i = 0;; i++) {
      let string = this.text[i], end = offset + string.length
      if ((isLine ? line : end) >= target)
        return new Line(offset, end, line, string)
      offset = end + 1
      line++
    }
  }

  decompose(from: number, to: number, target: Text[], open: Open) {
    let text = from <= 0 && to >= this.length ? this
      : new TextLeaf(sliceText(this.text, from, to), Math.min(to, this.length) - Math.max(0, from))
    if (open & Open.From) {
      let prev = target.pop() as TextLeaf
      let joined = appendText(text.text, prev.text.slice(), 0, text.length)
      if (joined.length <= Tree.Branch) {
        target.push(new TextLeaf(joined, prev.length + text.length))
      } else {
        let mid = joined.length >> 1
        target.push(new TextLeaf(joined.slice(0, mid)), new TextLeaf(joined.slice(mid)))
      }
    } else {
      target.push(text)
    }
  }

  replace(from: number, to: number, text: Text): Text {
    if (!(text instanceof TextLeaf)) return super.replace(from, to, text)
    let lines = appendText(this.text, appendText(text.text, sliceText(this.text, 0, from)), to)
    let newLen = this.length + text.length - (to - from)
    if (lines.length <= Tree.Branch) return new TextLeaf(lines, newLen)
    return TextNode.from(TextLeaf.split(lines, []), newLen)
  }

  sliceString(from: number, to = this.length, lineSep = "\n") {
    let result = ""
    for (let pos = 0, i = 0; pos <= to && i < this.text.length; i++) {
      let line = this.text[i], end = pos + line.length
      if (pos > from && i)
        result += lineSep
      if (from < end && to > pos)
        result += line.slice(Math.max(0, from - pos), to - pos)
      pos = end + 1
    }
    return result
  }

  flatten(target: string[]) {
    for (let line of this.text) target.push(line)
  }

  static split(text: readonly string[], target: Text[]): Text[] {
    let part = [], len = -1
    for (let line of text) {
      part.push(line)
      len += line.length + 1
      if (part.length == Tree.Branch) {
        target.push(new TextLeaf(part, len))
        part = []
        len = -1
      }
    }
    if (len > -1) target.push(new TextLeaf(part, len))
    return target
  }
}

// Nodes provide the tree structure of the `Text` type. They store a
// number of other nodes or leaves, taking care to balance themselves
// on changes. There are implied line breaks _between_ the children of
// a node (but not before the first or after the last child).
class TextNode extends Text {
  readonly lines = 0

  constructor(readonly children: readonly Text[], readonly length: number) {
    super()
    for (let child of children) this.lines += child.lines
  }

  lineInner(target: number, isLine: boolean, line: number, offset: number): Line {
    for (let i = 0;; i++) {
      let child = this.children[i], end = offset + child.length, endLine = line + child.lines - 1
      if ((isLine ? endLine : end) >= target)
        return child.lineInner(target, isLine, line, offset)
      offset = end + 1
      line = endLine + 1
    }
  }

  decompose(from: number, to: number, target: Text[], open: Open) {
    for (let i = 0, pos = 0; pos <= to && i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (from <= end && to >= pos) {
        let childOpen = open & ((pos <= from ? Open.From : 0) | (end >= to ? Open.To : 0))
        if (pos >= from && end <= to && !childOpen) target.push(child)
        else child.decompose(from - pos, to - pos, target, childOpen)
      }
      pos = end + 1
    }
  }

  replace(from: number, to: number, text: Text): Text {
    if (text.lines < this.lines) for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      // Fast path: if the change only affects one child and the
      // child's size remains in the acceptable range, only update
      // that child
      if (from >= pos && to <= end) {
        let updated = child.replace(from - pos, to - pos, text)
        let totalLines = this.lines - child.lines + updated.lines
        if (updated.lines < (totalLines >> (Tree.BranchShift - 1)) &&
            updated.lines > (totalLines >> (Tree.BranchShift + 1))) {
          let copy = this.children.slice()
          copy[i] = updated
          return new TextNode(copy, this.length - (to - from) + text.length)
        }
        return super.replace(pos, end, updated)
      }
      pos = end + 1
    }
    return super.replace(from, to, text)
  }

  sliceString(from: number, to = this.length, lineSep = "\n") {
    let result = ""
    for (let i = 0, pos = 0; i < this.children.length && pos <= to; i++) {
      let child = this.children[i], end = pos + child.length
      if (pos > from && i) result += lineSep
      if (from < end && to > pos) result += child.sliceString(from - pos, to - pos, lineSep)
      pos = end + 1
    }
    return result
  }

  flatten(target: string[]) {
    for (let child of this.children) child.flatten(target)
  }

  static from(children: Text[], length: number = children.reduce((l, ch) => l + ch.length + 1, -1)): Text {
    let lines = 0
    for (let ch of children) lines += ch.lines
    if (lines < Tree.Branch) {
      let flat: string[] = []
      for (let ch of children) ch.flatten(flat)
      return new TextLeaf(flat, length)
    }
    let chunk = Math.max(Tree.Branch, lines >> Tree.BranchShift), maxChunk = chunk << 1, minChunk = chunk >> 1
    let chunked: Text[] = [], currentLines = 0, currentLen = -1, currentChunk: Text[] = []
    function add(child: Text) {
      let last
      if (child.lines > maxChunk && child instanceof TextNode) {
        for (let node of child.children) add(node)
      } else if (child.lines > minChunk && (currentLines > minChunk || !currentLines)) {
        flush()
        chunked.push(child)
      } else if (child instanceof TextLeaf && currentLines &&
                 (last = currentChunk[currentChunk.length - 1]) instanceof TextLeaf &&
                 child.lines + last.lines <= Tree.Branch) {
        currentLines += child.lines
        currentLen += child.length + 1
        currentChunk[currentChunk.length - 1] = new TextLeaf(last.text.concat(child.text), last.length + 1 + child.length)
      } else {
        if (currentLines + child.lines > chunk) flush()
        currentLines += child.lines
        currentLen += child.length + 1
        currentChunk.push(child)
      }
    }
    function flush() {
      if (currentLines == 0) return
      chunked.push(currentChunk.length == 1 ? currentChunk[0] : TextNode.from(currentChunk, currentLen))
      currentLen = -1
      currentLines = currentChunk.length = 0
    }

    for (let child of children) add(child)
    flush()
    return chunked.length == 1 ? chunked[0] : new TextNode(chunked, length)
  }
}

Text.empty = new TextLeaf([""], 0)

function textLength(text: readonly string[]) {
  let length = -1
  for (let line of text) length += line.length + 1
  return length
}

function appendText(text: readonly string[], target: string[], from = 0, to = 1e9): string[] {
  for (let pos = 0, i = 0, first = true; i < text.length && pos <= to; i++) {
    let line = text[i], end = pos + line.length
    if (end >= from) {
      if (end > to) line = line.slice(0, to - pos)
      if (pos < from) line = line.slice(from - pos)
      if (first) { target[target.length - 1] += line; first = false }
      else target.push(line)
    }
    pos = end + 1
  }
  return target
}

function sliceText(text: readonly string[], from?: number, to?: number): string[] {
  return appendText(text, [""], from, to)
}

class RawTextCursor implements TextIterator {
  public done: boolean = false
  public lineBreak: boolean = false
  public value: string = ""
  private nodes: Text[]
  private offsets: number[]

  constructor(text: Text, readonly dir: 1 | -1 = 1) {
    this.nodes = [text]
    this.offsets = [dir > 0 ? 0 : text instanceof TextLeaf ? text.text.length : text.children!.length]
  }

  next(skip: number = 0): this {
    for (;;) {
      let last = this.nodes.length - 1
      if (last < 0) {
        this.done = true
        this.value = ""
        this.lineBreak = false
        return this
      }
      let top = this.nodes[last], offset = this.offsets[last]
      let size = top instanceof TextLeaf ? top.text.length : top.children!.length
      if (offset == (this.dir > 0 ? size : 0)) {
        this.nodes.pop()
        this.offsets.pop()
      } else if (!this.lineBreak && offset != (this.dir > 0 ? 0 : size)) {
        // Internal offset with lineBreak == false means we have to
        // count the line break at this position
        this.lineBreak = true
        if (skip == 0) {
          this.value = "\n"
          return this
        }
        skip--
      } else if (top instanceof TextLeaf) {
        // Move to the next string
        let next = top.text[offset - (this.dir < 0 ? 1 : 0)]
        this.offsets[last] = (offset += this.dir)
        this.lineBreak = false
        if (next.length > Math.max(0, skip)) {
          this.value = skip == 0 ? next : this.dir > 0 ? next.slice(skip) : next.slice(0, next.length - skip)
          return this
        }
        skip -= next.length
      } else {
        let next = top.children![this.dir > 0 ? offset : offset - 1]
        this.offsets[last] = offset + this.dir
        this.lineBreak = false
        if (skip > next.length) {
          skip -= next.length
        } else {
          this.nodes.push(next)
          this.offsets.push(this.dir > 0 ? 0 : next instanceof TextLeaf ? next.text.length : next.children!.length)
        }
      }
    }
  }
}

class PartialTextCursor implements TextIterator {
  cursor: RawTextCursor
  limit: number
  skip: number
  value: string = ""

  constructor(text: Text, start: number, end: number) {
    this.cursor = new RawTextCursor(text, start > end ? -1 : 1)
    if (start > end) {
      this.skip = text.length - start
      this.limit = start - end
    } else {
      this.skip = start
      this.limit = end - start
    }
  }

  next(skip = 0): this {
    if (this.limit <= 0) {
      this.limit = -1
    } else {
      let {value, lineBreak, done} = this.cursor.next(this.skip + skip)
      this.skip = 0
      this.value = value
      let len = lineBreak ? 1 : value.length
      if (len > this.limit)
        this.value = this.cursor.dir > 0 ? value.slice(0, this.limit) : value.slice(len - this.limit)
      if (done || this.value.length == 0) this.limit = -1
      else this.limit -= this.value.length
    }
    return this
  }

  get lineBreak() { return this.cursor.lineBreak }

  get done() { return this.limit < 0 }
}

/// This type describes a line in the document. It is created
/// on-demand when lines are [queried](#text.Text.lineAt).
export class Line {
  /// @internal
  constructor(
    /// The position of the start of the line.
    readonly from: number,
    /// The position at the end of the line (_before_ the line break,
    /// or at the end of document for the last line).
    readonly to: number,
    /// This line's line number (1-based).
    readonly number: number,
    /// The line's content.
    readonly text: string
  ) {}

  /// The length of the line (not including any line break after it).
  get length() { return this.to - this.from }
}
