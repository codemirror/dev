import {Text} from "../../text"

const empty: ReadonlyArray<any> = []

/// Distinguishes different ways in which positions can be mapped.
export enum MapMode {
  /// Map a position to a valid new position, even when its context
  /// was deleted.
  Simple,
  /// Return a negative number if a deletion happens across the
  /// position. This number will be `-(newPos + 1)`, where `newPos` is
  /// the result you'd get with `MapMode.Simple`.
  TrackDel,
  /// Return a negative number if the character _before_ the position
  /// is deleted. The result is encoded the same way as with
  /// `MapMode.TrackDel`.
  TrackBefore,
  /// Return a negative number if the character _after_ the position is
  /// deleted.
  TrackAfter
}

/// Interface for things that support position mapping.
export interface Mapping {
  /// Map a given position through a set of changes.
  ///
  /// `bias` indicates whether, when content is inserted at the
  /// position or the content around the position is replaced, the
  /// position at the end (positive) or start (negative or zero) of
  /// that change should be used. It defaults to `-1`.
  ///
  /// `mode` determines whether deletions should be
  /// [reported](#state.MapMode). It defaults to `MapMode.Simple`
  /// (don't report deletions).
  mapPos(pos: number, bias?: number, mode?: MapMode): number
}

/// A change description describes a document change. This is usually
/// used as a superclass of [`Change`](#state.Change), but can be used
/// to store change data without storing the replacement string
/// content.
export class ChangeDesc implements Mapping {
  /// Create a description that replaces the text between positions
  /// `from` and `to` with a new string of length `length`.
  constructor(
    /// The start position of the change.
    public readonly from: number,
    /// The end of the change (as a pre-change document position).
    public readonly to: number,
    /// The length of the replacing content.
    public readonly length: number
  ) {}

  /// Get the change description of the inverse of this change.
  get invertedDesc() { return new ChangeDesc(this.from, this.from + this.length, this.to - this.from) }

  /// @internal
  mapPos(pos: number, bias: number = -1, mode: MapMode = MapMode.Simple): number {
    let {from, to, length} = this
    if (pos < from) return pos
    if (pos > to) return pos + (length - (to - from))
    if (pos == to || pos == from) {
      if (from < pos && mode == MapMode.TrackBefore || to > pos && mode == MapMode.TrackAfter) return -pos - 1
      return (from == to ? bias <= 0 : pos == from) ? from : from + length
    }
    pos = from + (bias <= 0 ? 0 : length)
    return mode != MapMode.Simple ? -pos - 1 : pos
  }

  /// Return a JSON-serializeable object representing this value.
  toJSON(): any { return this }

  /// Create a change description from its JSON representation.
  static fromJSON(json: any) {
    if (!json || typeof json.from != "number" || typeof json.to != "number" || typeof json.length != "number")
      throw new RangeError("Invalid JSON representation for ChangeDesc")
    return new ChangeDesc(json.from, json.to, json.length)
  }
}

/// Change objects describe changes to the document.
export class Change extends ChangeDesc {
  /// Create a change that replaces `from` to `to` with `text`. The
  /// text is given as an array of lines. When it doesn't span lines,
  /// the array has a single element. When it does, a new element is
  /// added for every line. It should never have zero elements.
  constructor(
    public readonly from: number,
    public readonly to: number,
    /// The replacement content.
    public readonly text: ReadonlyArray<string>
  ) {
    super(from, to, textLength(text))
  }

  /// Create the inverse of this change when applied to the given
  /// document. `change.invert(doc).apply(change.apply(doc))` gets you
  /// the same document as the original `doc`.
  invert(doc: Text): Change {
    return new Change(this.from, this.from + this.length, doc.sliceLines(this.from, this.to))
  }

  /// Apply this change to the given content, returning an updated
  /// version of the document.
  apply(doc: Text): Text {
    return doc.replace(this.from, this.to, this.text)
  }

  /// Map this change through a mapping, producing a new change that
  /// can be applied to a post-mapping document. May return null if
  /// the mapping completely replaces the region this change would
  /// apply to.
  map(mapping: Mapping): Change | null {
    let from = mapping.mapPos(this.from, 1), to = mapping.mapPos(this.to, -1)
    return from > to ? null : new Change(from, to, this.text)
  }

  /// A change description for this change.
  get desc() { return new ChangeDesc(this.from, this.to, this.length) }

  /// Produce a JSON-serializable object representing this change.
  toJSON(): any {
    return {from: this.from, to: this.to, text: this.text}
  }

  /// Read a change instance from its JSON representation.
  static fromJSON(json: any) {
    if (!json || typeof json.from != "number" || typeof json.to != "number" ||
        !Array.isArray(json.text) || json.text.length == 0 || json.text.some((val: any) => typeof val != "string"))
      throw new RangeError("Invalid JSON representation for Change")
    return new Change(json.from, json.to, json.text)
  }
}

function textLength(text: ReadonlyArray<string>) {
  let length = -1
  for (let line of text) length += line.length + 1
  return length
}

/// A change set holds a sequence of changes or change descriptions.
export class ChangeSet<C extends ChangeDesc = Change> implements Mapping {
  /// @internal
  constructor(
    /// The changes in this set.
    readonly changes: ReadonlyArray<C>,
    /// @internal
    readonly mirror: ReadonlyArray<number> = empty) {}

  /// The number of changes in the set.
  get length(): number {
    return this.changes.length
  }

  /// Change sets can track which changes are inverses of each other,
  /// to allow robust position mapping in situations where changes are
  /// undone and then redone again. This queries which change is the
  /// mirror image of a given change (by index).
  getMirror(n: number): number | null {
    for (let i = 0; i < this.mirror.length; i++)
      if (this.mirror[i] == n) return this.mirror[i + (i % 2 ? -1 : 1)]
    return null
  }

  /// Append a change to this set, returning an extended set. `mirror`
  /// may be the index of a change already in the set, which
  /// [mirrors](#state.ChangeSet.getMirror) the new change.
  append(change: C, mirror?: number): ChangeSet<C> {
    return new ChangeSet(this.changes.concat(change),
                         mirror != null ? this.mirror.concat(this.length, mirror) : this.mirror)
  }

  /// Append another change set to this one.
  appendSet(changes: ChangeSet<C>): ChangeSet<C> {
    return changes.length == 0 ? this :
      this.length == 0 ? changes :
      new ChangeSet(this.changes.concat(changes.changes),
                    this.mirror.concat(changes.mirror.map(i => i + this.length)))
  }

  /// The empty change set.
  static empty: ChangeSet<any> = new ChangeSet(empty)

  /// @internal
  mapPos(pos: number, bias: number = -1, mode: MapMode = MapMode.Simple): number {
    return this.mapInner(pos, bias, mode, 0, this.length)
  }

  /// @internal
  mapInner(pos: number, bias: number, mode: MapMode, fromI: number, toI: number): number {
    let dir = toI < fromI ? -1 : 1
    let recoverables: {[key: number]: number} | null = null
    let hasMirrors = this.mirror.length > 0, rec, mirror, deleted = false
    for (let i = fromI - (dir < 0 ? 1 : 0), endI = toI - (dir < 0 ? 1 : 0); i != endI; i += dir) {
      let {from, to, length} = this.changes[i]
      if (dir < 0) {
        let len = to - from
        to = from + length
        length = len
      }

      if (pos < from) continue
      if (pos > to) {
        pos += length - (to - from)
        continue
      }
      // Change touches this position
      if (recoverables && (rec = recoverables[i]) != null) { // There's a recovery for this change, and it applies
        pos = from + rec
        continue
      }
      if (hasMirrors && (mirror = this.getMirror(i)) != null &&
          (dir > 0 ? mirror > i && mirror < toI : mirror < i && mirror >= toI)) { // A mirror exists
        if (pos > from && pos < to) { // If this change deletes the position, skip forward to the mirror
          i = mirror
          pos = this.changes[i].from + (pos - from)
          continue
        }
        // Else store a recoverable
        ;(recoverables || (recoverables = {}))[mirror] = pos - from
      }
      if (pos > from && pos < to) {
        if (mode != MapMode.Simple) deleted = true
        pos = bias <= 0 ? from : from + length
      } else {
        if (from < pos && mode == MapMode.TrackBefore || to > pos && mode == MapMode.TrackAfter) deleted = true
        pos = (from == to ? bias <= 0 : pos == from) ? from : from + length
      }
    }
    return deleted ? -pos - 1 : pos
  }

  /// Get a partial [mapping](#state.Mapping) covering part of this
  /// change set.
  partialMapping(from: number, to: number = this.length): Mapping {
    if (from == 0 && to == this.length) return this
    return new PartialMapping(this, from, to)
  }

  /// Summarize this set of changes as a minimal sequence of changed
  /// ranges, sored by position. For example, if you have changes
  /// deleting between 1 and 4 and inserting a character at 1, the
  /// result would be a single range saying 1 to 4 in the old doc was
  /// replaced with range 1 to 2 in the new doc.
  changedRanges(): ChangedRange[] {
    // FIXME cache this?
    let set: ChangedRange[] = []
    for (let i = 0; i < this.length; i++) {
      let change = this.changes[i]
      let fromA = change.from, toA = change.to, fromB = change.from, toB = change.from + change.length
      if (i < this.length - 1) {
        let mapping = this.partialMapping(i + 1)
        fromB = mapping.mapPos(fromB, 1); toB = mapping.mapPos(toB, -1)
      }
      if (i > 0) {
        let mapping = this.partialMapping(i, 0)
        fromA = mapping.mapPos(fromA, 1); toA = mapping.mapPos(toA, -1)
      }
      new ChangedRange(fromA, toA, fromB, toB).addToSet(set)
    }
    return set
  }

  /// Convert a set of changes to a set of change descriptions.
  get desc(): ChangeSet<ChangeDesc> {
    if (this.changes.length == 0 || this.changes[0] instanceof ChangeDesc) return this
    return new ChangeSet(this.changes.map(ch => (ch as any).desc), this.mirror)
  }

  /// Create a JSON-serializable representation of this change set.
  toJSON(): any {
    let changes = this.changes.map(change => change.toJSON())
    return this.mirror.length == 0 ? changes : {mirror: this.mirror, changes}
  }

  /// Read a change set from its JSON representation.
  static fromJSON<C extends ChangeDesc>(ChangeType: {fromJSON: (json: any) => C}, json: any): ChangeSet<C> {
    let mirror, changes
    if (Array.isArray(json)) {
      mirror = empty
      changes = json
    } else if (!json || !Array.isArray(json.mirror) || !Array.isArray(json.changes)) {
      throw new RangeError("Invalid JSON representation for ChangeSet")
    } else {
      ;({mirror, changes} = json)
    }
    return new ChangeSet(changes.map((ch: any) => ChangeType.fromJSON(ch)), mirror)
  }
}

class PartialMapping implements Mapping {
  constructor(readonly changes: ChangeSet<any>, readonly from: number, readonly to: number) {}
  mapPos(pos: number, bias: number = -1, mode: MapMode = MapMode.Simple): number {
    return this.changes.mapInner(pos, bias, mode, this.from, this.to)
  }
}

/// A changed range represents a replacement as two absolute ranges,
/// one pointing into the old document (the replaced content) and one
/// pointing into the new document (the content that replaces it).
export class ChangedRange {
  // FIXME store unchanged ranges instead?
  constructor(
    /// The start of the replaced range in the old document.
    readonly fromA: number,
    /// The end of the replaced range in the old document.
    readonly toA: number,
    /// The start of the replacing range in the new document.
    readonly fromB: number,
    /// The end of the replacing range in the new document.
    readonly toB: number) {}

  /// @internal
  join(other: ChangedRange): ChangedRange {
    return new ChangedRange(Math.min(this.fromA, other.fromA), Math.max(this.toA, other.toA),
                            Math.min(this.fromB, other.fromB), Math.max(this.toB, other.toB))
  }

  /// @internal
  // FIXME used by view. Document?
  addToSet(set: ChangedRange[]): ChangedRange[] {
    let i = set.length, me: ChangedRange = this
    for (; i > 0; i--) {
      let range = set[i - 1]
      if (range.fromA > me.toA) continue
      if (range.toA < me.fromA) break
      me = me.join(range)
      set.splice(i - 1, 1)
    }
    set.splice(i, 0, me)
    return set
  }

  /// The difference in document length created by this change
  /// (positive when the document grew).
  get lenDiff() { return (this.toB - this.fromB) - (this.toA - this.fromA) }

  /// @internal
  static mapPos(pos: number, bias: number, changes: ReadonlyArray<ChangedRange>): number {
    let off = 0
    for (let range of changes) {
      if (pos < range.fromA) break
      if (pos <= range.toA) {
        let side = range.toA == range.fromA ? bias : pos == range.fromA ? -1 : pos == range.toA ? 1 : bias
        return side < 0 ? range.fromB : range.toB
      }
      off = range.toB - range.toA
    }
    return pos + off
  }
}
