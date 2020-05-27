import {EditorState} from "./state"
import {ChangeDesc} from "./change"
import {charType} from "@codemirror/next/text"

// A range's flags field is used like this:
// - 2 bits for bidi level (3 means unset) (only meaningful for
//   cursors)
// - 2 bits to indicate the side the cursor is associated with (only
//   for cursors)
// - 1 bit to indicate whether the range is inverted (head before
//   anchor) (only meaningful for non-empty ranges)
const enum RangeFlag {
  BidiLevelMask = 3,
  AssocBefore = 4,
  AssocAfter = 8,
  Inverted = 16
}
  
/// A single selection range. When
/// [`allowMultipleSelections`](#state.EditorState^allowMultipleSelections)
/// is enabled, a [selection](#state.EditorSelection) may hold
/// multiple ranges. By default, selections hold exactly one range.
export class SelectionRange {
  // @internal
  constructor(
    /// The lower side of the range.
    readonly from: number,
    /// The upper side of the range.
    readonly to: number,
    private flags: number
  ) {}

  /// The anchor of the range—the side that doesn't move when you
  /// extend it.
  get anchor() { return this.flags & RangeFlag.Inverted ? this.to : this.from }

  /// The head of the range, which is moved when the range is
  /// [extended](#state.SelectionRange.extend).
  get head() { return this.flags & RangeFlag.Inverted ? this.from : this.to }

  /// True when `anchor` and `head` are at the same position.
  get empty(): boolean { return this.from == this.to }

  /// If this is a cursor that is explicitly associated with the
  /// character on one of its sides, this returns the side. -1 means
  /// the character before its position, 1 the character after, and 0
  /// means no association.
  get assoc(): -1 | 0 | 1 { return this.flags & RangeFlag.AssocBefore ? -1 : this.flags & RangeFlag.AssocAfter ? 1 : 0 }

  /// The bidirectional text level associated with this cursor.
  get bidiLevel(): number | null {
    let level = this.flags & RangeFlag.BidiLevelMask
    return level == 3 ? null : level
  }

  /// Map this range through a mapping.
  map(mapping: ChangeDesc): SelectionRange {
    let from = mapping.mapPos(this.from), to = mapping.mapPos(this.to)
    return from == this.from && to == this.to ? this : new SelectionRange(from, to, this.flags)
  }

  /// Extend this range to cover at least `from` to `to`.
  extend(from: number, to: number = from) {
    if (from <= this.anchor && to >= this.anchor) return EditorSelection.range(from, to)
    let head = Math.abs(from - this.anchor) > Math.abs(to - this.anchor) ? from : to
    return EditorSelection.range(this.anchor, head)
  }

  /// Compare this range to another range. Will only compare
  /// [association](#state.SelectionRange.assoc) side and [bidi
  /// level](#state.SelectionRange.bidiLevel) when `precise` is true.
  eq(other: SelectionRange, precise = false): boolean {
    let mask = precise ? 0xff : RangeFlag.Inverted
    return this.from == other.from && this.to == other.to && (this.flags & mask) == (other.flags & mask)
  }

  /// Return a JSON-serializable object representing the range.
  toJSON(): any { return {anchor: this.anchor, head: this.head} }

  /// Convert a JSON representation of a range to a `SelectionRange`
  /// instance.
  static fromJSON(json: any): SelectionRange {
    if (!json || typeof json.anchor != "number" || typeof json.head != "number")
      throw new RangeError("Invalid JSON representation for SelectionRange")
    return EditorSelection.range(json.anchor, json.head)
  }

  /// @internal FIXME export?
  static groupAt(state: EditorState, pos: number, bias: 1 | -1 = 1) {
    // FIXME at some point, take language-specific identifier characters into account
    let line = state.doc.lineAt(pos), linePos = pos - line.start
    if (line.length == 0) return EditorSelection.cursor(pos)
    if (linePos == 0) bias = 1
    else if (linePos == line.length) bias = -1
    let read = linePos + (bias < 0 ? -1 : 0), type = charType(line.slice(read, read + 1))
    let from = pos, to = pos
    for (let lineFrom = linePos; lineFrom > 0 && charType(line.slice(lineFrom - 1, lineFrom)) == type; lineFrom--) from--
    for (let lineTo = linePos; lineTo < line.length && charType(line.slice(lineTo, lineTo + 1)) == type; lineTo++) to++
    return EditorSelection.range(to, from)
  }
}

/// An editor selection holds one or more selection ranges.
export class EditorSelection {
  /// @internal
  constructor(
    /// The ranges in the selection, sorted by position. Ranges cannot
    /// overlap (but they may touch, if they aren't empty).
    readonly ranges: readonly SelectionRange[],
    /// The index of the _primary_ range in the selection (which is
    /// usually the range that was added last).
    readonly primaryIndex: number = 0
  ) {}

  /// Map a selection through a mapping. Mostly used to adjust the
  /// selection position for changes.
  map(mapping: ChangeDesc): EditorSelection {
    if (mapping.empty) return this
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

  /// Get the primary selection range. Usually, you should make sure
  /// your code applies to _all_ ranges, by using transaction methods
  /// like [`forEachRange`](#state.Transaction.forEachRange).
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

  /// Replace a given range with another range, and then normalize the
  /// selection to merge and sort ranges if necessary.
  replaceRange(range: SelectionRange, which: number = this.primaryIndex) {
    let ranges = this.ranges.slice()
    ranges[which] = range
    return EditorSelection.create(ranges, this.primaryIndex)
  }

  /// Convert this selection to an object that can be serialized to
  /// JSON.
  toJSON(): any {
    return {ranges: this.ranges.map(r => r.toJSON()), primaryIndex: this.primaryIndex}
  }

  /// Create a selection from a JSON representation.
  static fromJSON(json: any): EditorSelection {
    if (!json || !Array.isArray(json.ranges) || typeof json.primaryIndex != "number" || json.primaryIndex >= json.ranges.length)
      throw new RangeError("Invalid JSON representation for EditorSelection")
    return new EditorSelection(json.ranges.map((r: any) => SelectionRange.fromJSON(r)), json.primaryIndex)
  }

  /// Create a selection holding a single range.
  static single(anchor: number, head: number = anchor) {
    return new EditorSelection([EditorSelection.range(anchor, head)], 0)
  }

  /// Sort and merge the given set of ranges, creating a valid
  /// selection.
  static create(ranges: readonly SelectionRange[], primaryIndex: number = 0) {
    for (let pos = 0, i = 0; i < ranges.length; i++) {
      let range = ranges[i]
      if (range.empty ? range.from <= pos : range.from < pos) return normalized(ranges.slice(), primaryIndex)
      pos = range.to
    }
    return new EditorSelection(ranges, primaryIndex)
  }

  /// Create a cursor selection range at the given position. You can
  /// probably ignore [association](#state.SelectionRange.assoc) and
  /// [bidi level](#state.SelectionRange.bidiLevel) in most
  /// situations.
  static cursor(pos: number, assoc = 0, bidiLevel?: number) {
    return new SelectionRange(pos, pos, (assoc == 0 ? 0 : assoc < 0 ? RangeFlag.AssocBefore : RangeFlag.AssocAfter) |
                              (bidiLevel == null ? 3 : Math.min(2, bidiLevel)))
  }

  /// Create a selection range.
  static range(anchor: number, head: number) {
    return head < anchor ? new SelectionRange(head, anchor, RangeFlag.Inverted) : new SelectionRange(anchor, head, 0)
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
      ranges.splice(--i, 2, range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to))
    }
  }
  return new EditorSelection(ranges, primaryIndex)
}

export function checkSelection(selection: EditorSelection, docLength: number) {
  for (let range of selection.ranges)
    if (range.to > docLength) throw new RangeError("Selection points outside of document")
}
