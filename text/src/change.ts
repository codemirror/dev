import {Text, textLength, sliceText} from "./text"

/// Changes are represented as a sequence of sections. Each section
/// either keeps a span of old content, deletes a span, or inserts new
/// content.
export enum Section {
  Keep = 0,
  Delete = 1,
  Insert = 2
}

/// Distinguishes different ways in which positions can be mapped.
export enum MapMode {
  /// Map a position to a valid new position, even when its context
  /// was deleted.
  Simple,
  /// Return -1 if deletion happens across the position.
  TrackDel,
  /// Return -1 if the character _before_ the position is deleted.
  TrackBefore,
  /// Return -1 if the character _after_ the position is deleted.
  TrackAfter
}

/// Used to represent changes when building up a change set. Inserted
/// content must already be split into lines.
export type ChangeSpec = {insert: readonly string[], at: number} | {delete: number, to: number}

// And the same enum again, inlined (just because). Internally, change
// sections are represented by pairs of integers, with the type in the
// first value and its length in the second.
const enum Type {
  Keep = 0,
  Del = 1,
  Ins = 2
}

/// A change description is a variant of [change set](#text.ChangeSet)
/// that doesn't store the inserted text. As such, it can't be
/// applied, but is cheaper to store and manipulate.
export class ChangeDesc {
  /// @internal
  constructor(readonly sections: readonly number[]) {}

  /// The length of the document before the change.
  get length() { return getLen(this.sections, Type.Ins) }

  /// The length of the document after the change.
  get newLength() { return getLen(this.sections, Type.Del) }

  /// False when there are actual changes in this set.
  get empty() { return this.sections.length == 0 || this.sections.length == 2 && this.sections[0] == Type.Keep }

  /// Iterate over the sections in this change set, calling `f` for
  /// each. If this is a `ChangeSet`, this will pass the inserted text
  /// as last argument to the function when reporting an insertion.
  iter(f: (type: Section, fromA: number, toA: number, fromB: number, toB: number, inserted: readonly string[] | null) => void) {
    let posA = 0, posB = 0, inserted = (this as any).inserted
    for (let i = 0; i < this.sections.length;) {
      let type = this.sections[i++], len = this.sections[i++], endA = posA, endB = posB, ins: null | readonly string[] = null
      if (type == Type.Keep) {
        endA += len; endB += len
      } else if (type == Type.Ins) {
        endB += len
        if (inserted) ins = inserted[(i - 2) >> 1]
      } else {
        endA += len
      }
      f(type, posA, endA, posB, endB, ins)
      posA = endA; posB = endB
    }
  }

  /// Iterate over the unchanged parts left by these changes.
  gaps(f: (posA: number, posB: number, length: number) => void) {
    for (let i = 0, posA = 0, posB = 0; i < this.sections.length;) {
      let type = this.sections[i++], len = this.sections[i++]
      if (type == Type.Keep) {
        f(posA, posB, len)
        posA += len
        posB += len
      } else if (type == Type.Ins) {
        posB += len
      } else {
        posA += len
      }
    }
  }

  /// Get the inverted form of thes changes.
  invertedDesc() {
    return new ChangeDesc(this.sections.map((v, i) => i % 2 || v == Type.Keep ? v : v == Type.Del ? Type.Ins : Type.Del))
  }

  /// Compute the combined effect of applying another set of changes
  /// after this one. The length of the document after this set should
  /// match the length before `other`.
  composeDesc(other: ChangeDesc) { return joinSets(this, other, joinCompose) }

  /// Compute the combined effect of applying both this set and
  /// another set to the same document.
  combineDesc(other: ChangeDesc) { return joinSets(this, other, joinCombine) }

  /// Map this description, which should start with the same document
  /// as `other`, over another set of changes, so that it can be
  /// applied after it.
  mapDesc(other: ChangeDesc | ChangeSet, before = false): ChangeDesc {
    return joinSets(this, other, before ? joinMapBefore : joinMapAfter)
  }

  /// Map a given position through these changes.
  ///
  /// `assoc` indicates which side the position should be associated
  /// with. When it is negative or zero, the mapping will try to keep
  /// the position close to the character before it (if any), and will
  /// move it before insertions at that point or replacements across
  /// that point. When it is positive, the position is associated with
  /// the character after it, and will be moved forward for insertions
  /// at or replacements across the position. Defaults to -1.
  ///
  /// `mode` determines whether deletions should be
  /// [reported](#state.MapMode). It defaults to `MapMode.Simple`
  /// (don't report deletions).
  mapPos(pos: number, assoc = -1, mode: MapMode = MapMode.Simple) {
    let result = pos
    for (let i = 0, off = 0; i < this.sections.length;) {
      let type = this.sections[i++], len = this.sections[i++]
      if (type == Type.Ins) {
        if (off < pos || assoc > 0) result += len
      } else if (type == Type.Del) {
        if (mode != MapMode.Simple &&
            (mode == MapMode.TrackDel && off < pos && off + len > pos ||
             mode == MapMode.TrackBefore && off < pos && off + len >= pos ||
             mode == MapMode.TrackAfter && off <= pos && off + len > pos)) return -1
        result -= Math.min(len, pos - off)
        off += len
      } else {
        off += len
      }
      if (off > pos) break
    }
    return result
  }

  /// Check whether these changes touch a given range. When one of the
  /// changes entirely covers the range, the string `"cover"` is
  /// returned.
  touchesRange(from: number, to: number): boolean | "cover" {
    for (let i = 0, pos = 0; i < this.sections.length && pos <= to;) {
      let type = this.sections[i++], len = this.sections[i++]
      if (type == Type.Keep) {
        pos += len
      } else if (type == Type.Del) {
        let end = pos + len
        if (pos <= to && end >= from)
          return pos < from && end > to ? "cover" : true
        pos = end
      } else {
        if (pos >= from && pos <= to) return true
      }
    }
    return false
  }

  /// @internal
  toString() {
    let result = ""
    for (let i = 0, s = this.sections; i < s.length; i += 2)
      result += (s[i] == Type.Del ? "d" : s[i] == Type.Keep ? "k" : "i") + s[i + 1]
    return result
  }

  /// @internal
  static make(sections: readonly [Section, number][]) {
    let values = []
    for (let [type, len] of sections) values.push(type, len)
    return new ChangeDesc(values)
  }
}

/// A change set represents a group of modifications to a document. It
/// stores the document length, and can only be applied to documents
/// with exactly that length.
export class ChangeSet extends ChangeDesc {
  /// @internal
  constructor(
    sections: readonly number[],
    /// @internal
    readonly inserted: readonly (readonly string[] | null)[]
  ) {
    super(sections)
  }

  /// Apply the changes to a document, returning the modified
  /// document.
  apply(doc: Text) {
    if (this.length != doc.length) throw new RangeError("Applying change set to a document with the wrong length")
    for (let pos = 0, i = 0; i < this.sections.length;) {
      let type = this.sections[i++], len = this.sections[i++]
      if (type == Type.Keep) {
        pos += len
      } else {
        let start = pos, end = pos, text: readonly string[] = noText
        for (;;) {
          if (type == Type.Ins) {
            pos += len
            let ins = this.inserted[(i - 2) >> 1] as readonly string[]
            text = text == noText ? ins : appendText(text, ins)
          } else {
            end += len
          }
          if (i == this.sections.length || this.sections[i] == Type.Keep) break
          type = this.sections[i++]; len = this.sections[i++]
        }
        doc = doc.replace(start, end, text)
      }
    }
    return doc
  }

  /// Given the document as it existed _before_ the changes, return a
  /// change set that represents the inverse of this set, which could
  /// be used to go from the document created by the changes back to
  /// the document as it existed before the changes.
  invert(doc: Text) {
    let sections = this.sections.slice(), inserted = []
    for (let i = 0, pos = 0; i < sections.length; i += 2) {
      let type = sections[i], len = sections[i + 1]
      if (type == Type.Ins) {
        sections[i] = Type.Del
      } else if (type == Type.Del) {
        sections[i] = Type.Ins
        let index = i >> 1
        while (inserted.length < index) inserted.push(null)
        inserted.push(doc.sliceLines(pos, pos + len))
        pos += len
      } else {
        pos += len
      }
    }
    return new ChangeSet(sections, inserted)
  }

  // Combine two subsequent change sets into a single set. `other`
  // must start in the document produced by `this`. If `this` goes
  // `docA` → `docB` and `other` represents `docB` → `docC`, the
  // returned value will represent the change `docA` → `docC`.
  compose(other: ChangeSet) { return joinSets(this, other, joinCompose, true) }

  /// Combine two change sets that start in the same document to
  /// create a change set that represents the union of both.
  combine(other: ChangeSet) { return joinSets(this, other, joinCombine, true) }

  // Given another change set starting in the same document, maps this
  // change set over the other, producing a new change set that can be
  // applied to the document produced by applying `other`. When
  // `before` is `true`, order changes as if `this` comes before
  // `other`, otherwise (the default) treat `other` as coming first.
  map(other: ChangeSet | ChangeDesc, before = false): ChangeSet {
    return joinSets(this, other, before ? joinMapBefore : joinMapAfter, true)
  }

  /// Get a [change description](#text.ChangeDesc) for this change
  /// set.
  get desc() { return new ChangeDesc(this.sections) }

  /// Create a change set for the given collection of changes.
  static of(length: number, changes: readonly ChangeSpec[]): ChangeSet {
    if (!changes.length) return new ChangeSet(length ? [Type.Keep, length] : empty, empty)
    let sets = []
    for (let change of changes as readonly any[]) {
      let sections: number[] = [], inserted = empty
      if (change.insert) {
        let insertLen = textLength(change.insert)
        if (insertLen) inserted = change.at ? [null, change.insert] : [change.insert]
        addSection(sections, Type.Keep, change.at)
        addSection(sections, Type.Ins, insertLen)
        addSection(sections, Type.Keep, length - change.at)
      } else {
        addSection(sections, Type.Keep, change.delete)
        addSection(sections, Type.Del, change.to - change.delete)
        addSection(sections, Type.Keep, length - change.to)
      }
      sets.push(new ChangeSet(sections, inserted))
    }
    return flatten(sets, 0, sets.length)
  }
}

function getLen(sections: readonly number[], ignore: Type) {
  let length = 0
  for (let i = 0; i < sections.length; i += 2) if (sections[i] != ignore) length += sections[i + 1]
  return length
}

const empty: readonly any[] = [], noText = [""]

// Recursively combine a set of changes
function flatten(sets: ChangeSet[], from: number, to: number): ChangeSet {
  if (to == from + 1) return sets[from]
  let mid = (from + to) >> 1
  return flatten(sets, from, mid).combine(flatten(sets, mid, to))
}

function addSection(array: number[], type: Type, len: number) {
  if (len == 0) return
  let last = array.length - 2
  if (last >= 0 && type == Type.Ins ? array[last] == Type.Ins : array[last] == type) array[last + 1] += len
  else array.push(type, len)
}

function appendText(a: readonly string[], b: readonly string[]) {
  let result = a.slice()
  result[result.length - 1] += b[0]
  for (let i = 1; i < b.length; i++) result.push(b[i])
  return result
}

const enum Join { Drop = 3, A = 4, B = 8, TypeMask = 3 }


function joinSets(a: ChangeDesc, b: ChangeDesc, f: (typeA: number, typeB: number) => number): ChangeDesc
function joinSets(a: ChangeDesc, b: ChangeDesc, f: (typeA: number, typeB: number) => number, mkSet: true): ChangeSet
function joinSets(a: ChangeDesc, b: ChangeDesc, f: (typeA: number, typeB: number) => number, mkSet = false): any {
  let sections: number[] = []
  let insert: (readonly string[] | null)[] = mkSet ? [] : null as any
  let iA = 0, typeA = Type.Keep, lenA = 0, offA = 0
  let iB = 0, typeB = Type.Keep, lenB = 0, offB = 0

  for (let moveA = 0, moveB = 0;;) {
    if (moveA < lenA) {
      lenA -= moveA
      offA += moveA
    } else if (iA < a.sections.length) {
      typeA = a.sections[iA++]
      lenA = a.sections[iA++]
      offA = 0
    } else {
      typeA = Type.Keep
      lenA = offA = 0
    }
    if (moveB < lenB) {
      lenB -= moveB
      offB += moveB
    } else if (iB < b.sections.length) {
      typeB = b.sections[iB++]
      lenB = b.sections[iB++]
      offB = 0
    } else {
      typeB = Type.Keep
      lenB = offB = 0
    }

    let join = f(typeA, typeB)
    let len, type = join & Join.TypeMask
    if (join & Join.A) {
      len = moveA = lenA
      moveB = 0
    } else if (join & Join.B) {
      len = moveB = lenB
      moveA = 0
    } else {
      moveA = moveB = len = Math.min(lenA, lenB)
    }
    if (type != Join.Drop) {
      addSection(sections, type, len)
      if (type == Type.Ins && mkSet) {
        let value = join & Join.A || !(join & Join.B) && typeA == Type.Ins
          ? takeInsert((a as ChangeSet).inserted, iA, offA, len) : takeInsert((b as ChangeSet).inserted, iB, offB, len)
        let index = (sections.length - 2) >> 1
        if (insert.length > index) { // Already exists
          insert[index] = appendText(insert[index] as readonly string[], value)
        } else {
          while (insert.length < index) insert.push(null)
          insert.push(value)
        }
      }
    }
    if (len == 0) {
      if (lenA != lenB) throw new RangeError("Mismatched change set lengths")
      return mkSet ? new ChangeSet(sections, insert) : new ChangeDesc(sections)
    }
  }
}

function takeInsert(array: readonly (readonly string[] | null)[], index: number, off: number, len: number): readonly string[] {
  let value = array[(index - 2) >> 1] as readonly string[]
  return off > 0 || off + len < textLength(value) ? sliceText(value, off, off + len) : value
}

function joinCompose(typeA: Type, typeB: Type) {
  if (typeA == Type.Del) return typeA | Join.A
  if (typeB == Type.Ins) return typeB | Join.B
  if (typeA == Type.Ins && typeB == Type.Del) return Join.Drop
  return typeA == Type.Keep ? typeB : typeA
}

function joinCombine(typeA: Type, typeB: Type) {
  if (typeA == Type.Ins) return typeA | Join.A
  if (typeB == Type.Ins) return typeB | Join.B
  return typeA == Type.Del ? typeA : typeB
}

function joinMapBefore(typeA: Type, typeB: Type) {
  if (typeA == Type.Ins) return typeA | Join.A
  if (typeB == Type.Ins) return Type.Keep | Join.B
  return typeB == Type.Del ? Join.Drop : typeA
}

function joinMapAfter(typeA: Type, typeB: Type) {
  if (typeB == Type.Ins) return Type.Keep | Join.B
  if (typeA == Type.Ins) return typeA | Join.A
  return typeB == Type.Del ? Join.Drop : typeA
}
