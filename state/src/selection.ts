import {Mapping} from "./change"
import {EditorState} from "./state"
import {charType} from "../../text/src"

/// A single selection range.
export class SelectionRange {
  /// Create a range.
  constructor(
    /// The anchor of the range—the side that doesn't move when you
    /// extend it.
    readonly anchor: number,
    /// The head of the range, which is moved when the range is
    /// [extended](#state.SelectionRange.extend). Defaults to `anchor`
    /// when not given.
    public readonly head: number = anchor) {}

  /// The lower side of the range.
  get from(): number { return Math.min(this.anchor, this.head) }
  /// The upper side of the range.
  get to(): number { return Math.max(this.anchor, this.head) }
  /// True when `anchor` and `head` are the same.
  get empty(): boolean { return this.anchor == this.head }

  /// Map this range through a mapping.
  map(mapping: Mapping): SelectionRange {
    let anchor = mapping.mapPos(this.anchor), head = mapping.mapPos(this.head)
    if (anchor == this.anchor && head == this.head) return this
    else return new SelectionRange(anchor, head)
  }

  /// Extend this range to cover at least `from` to `to`.
  extend(from: number, to: number = from) {
    if (from <= this.anchor && to >= this.anchor) return new SelectionRange(from, to)
    let head = Math.abs(from - this.anchor) > Math.abs(to - this.anchor) ? from : to
    return new SelectionRange(this.anchor, head)
  }

  /// Compare this range to another range.
  eq(other: SelectionRange): boolean {
    return this.anchor == other.anchor && this.head == other.head
  }

  /// Return a JSON-serializable object representing the range.
  toJSON(): any { return this }

  /// Convert a JSON representation of a range to a `SelectionRange`
  /// instance.
  static fromJSON(json: any): SelectionRange {
    if (!json || typeof json.anchor != "number" || typeof json.head != "number")
      throw new RangeError("Invalid JSON representation for SelectionRange")
    return new SelectionRange(json.anchor, json.head)
  }

  /// @internal FIXME export?
  static groupAt(state: EditorState, pos: number, bias: 1 | -1 = 1) {
    // FIXME at some point, take language-specific identifier characters into account
    let line = state.doc.lineAt(pos), linePos = pos - line.start
    if (line.length == 0) return new SelectionRange(pos)
    if (linePos == 0) bias = 1
    else if (linePos == line.length) bias = -1
    let read = linePos + (bias < 0 ? -1 : 0), type = charType(line.slice(read, read + 1))
    let from = pos, to = pos
    for (let lineFrom = linePos; lineFrom > 0 && charType(line.slice(lineFrom - 1, lineFrom)) == type; lineFrom--) from--
    for (let lineTo = linePos; lineTo < line.length && charType(line.slice(lineTo, lineTo + 1)) == type; lineTo++) to++
    return new SelectionRange(to, from)
  }
}

/// An editor selection holds one or more selection ranges.
export class EditorSelection {
  /// @internal
  constructor(
    /// The ranges in the selection, sorted by position. Ranges cannot
    /// overlap (but they may touch, if they aren't empty).
    readonly ranges: ReadonlyArray<SelectionRange>,
    /// The index of the _primary_ range in the selection (which is
    /// usually the range that was added last).
    readonly primaryIndex: number = 0
  ) {}

  /// Map a selection through a mapping.
  map(mapping: Mapping): EditorSelection {
    return EditorSelection.create(this.ranges.map(r => r.map(mapping)), this.primaryIndex)
  }

  /// Compare this selection to another selection.
  eq(other: EditorSelection): boolean {
    if (this.ranges.length != other.ranges.length ||
        this.primaryIndex != other.primaryIndex) return false
    for (let i = 0; i < this.ranges.length; i++)
      if (!this.ranges[i].eq(other.ranges[i])) return false
    return true
  }

  /// Get the primary selection range.
  get primary(): SelectionRange { return this.ranges[this.primaryIndex] }

  /// Make sure the selection only has one range. Returns a selection
  /// holding only the primary range from this selection.
  asSingle() {
    return this.ranges.length == 1 ? this : new EditorSelection([this.primary])
  }

  /// Extend this selection with an extra range.
  addRange(range: SelectionRange, primary: boolean = true) {
    return EditorSelection.create([range].concat(this.ranges), primary ? 0 : this.primaryIndex + 1)
  }

  /// Replace a given range with another range.
  replaceRange(range: SelectionRange, which: number = this.primaryIndex) {
    let ranges = this.ranges.slice()
    ranges[which] = range
    return EditorSelection.create(ranges, this.primaryIndex)
  }

  /// Convert this selection to an object that can be serialized to
  /// JSON.
  toJSON(): any {
    return this.ranges.length == 1 ? this.ranges[0].toJSON() :
      {ranges: this.ranges.map(r => r.toJSON()), primaryIndex: this.primaryIndex}
  }

  /// Create a selection from a JSON representation.
  static fromJSON(json: any): EditorSelection {
    if (json && Array.isArray(json.ranges)) {
      if (typeof json.primaryIndex != "number" || json.primaryIndex >= json.ranges.length)
        throw new RangeError("Invalid JSON representation for EditorSelection")
      return new EditorSelection(json.ranges.map((r: any) => SelectionRange.fromJSON(r)), json.primaryIndex)
    }
    return new EditorSelection([SelectionRange.fromJSON(json)])
  }

  /// Create a selection holding a single range.
  static single(anchor: number, head: number = anchor) {
    return new EditorSelection([new SelectionRange(anchor, head)], 0)
  }

  /// Sort and merge the given set of ranges, creating a valid
  /// selection.
  static create(ranges: ReadonlyArray<SelectionRange>, primaryIndex: number = 0) {
    for (let pos = 0, i = 0; i < ranges.length; i++) {
      let range = ranges[i]
      if (range.empty ? range.from <= pos : range.from < pos) return normalized(ranges.slice(), primaryIndex)
      pos = range.to
    }
    return new EditorSelection(ranges, primaryIndex)
  }
}

function normalized(ranges: SelectionRange[], primaryIndex: number = 0): EditorSelection {
  let primary = ranges[primaryIndex]
  ranges.sort((a, b) => a.from - b.from)
  primaryIndex = ranges.indexOf(primary)
  for (let i = 1; i < ranges.length; i++) {
    let range = ranges[i], prev = ranges[i - 1]
    if (range.empty ? range.from <= prev.to : range.from < prev.to) {
      let from = prev.from, to = Math.max(range.to, prev.to)
      if (i <= primaryIndex) primaryIndex--
      ranges.splice(--i, 2, range.anchor > range.head ? new SelectionRange(to, from) : new SelectionRange(from, to))
    }
  }
  return new EditorSelection(ranges, primaryIndex)
}
