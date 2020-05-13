import {Text} from "@codemirror/next/text"

export const DefaultSplit = /\r\n?|\n/

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

/// A change description is a variant of [change set](#text.ChangeSet)
/// that doesn't store the inserted text. As such, it can't be
/// applied, but is cheaper to store and manipulate.
export class ChangeDesc {
  // Sections are encoded as pairs of integers. The first is the
  // length in the current document, and the second is -1 for
  // unaffected sections, and the length of the replacement content
  // otherwise. So an insertion would be (0, n>0), a deletion (n>0,
  // 0), and a replacement two positive numbers.

  /// @internal
  constructor(readonly sections: readonly number[]) {}

  /// The length of the document before the change.
  get length() {
    let result = 0
    for (let i = 0; i < this.sections.length; i += 2) result += this.sections[i]
    return result
  }

  /// The length of the document after the change.
  get newLength() {
    let result = 0
    for (let i = 0; i < this.sections.length; i += 2) {
      let ins = this.sections[i + 1]
      result += ins < 0 ? this.sections[i] : ins
    }
    return result
  }

  /// False when there are actual changes in this set.
  get empty() { return this.sections.length == 0 || this.sections.length == 2 && this.sections[1] < 0 }

  /// Iterate over the unchanged parts left by these changes.
  iterGaps(f: (posA: number, posB: number, length: number) => void) {
    for (let i = 0, posA = 0, posB = 0; i < this.sections.length;) {
      let len = this.sections[i++], ins = this.sections[i++]
      if (ins < 0) {
        f(posA, posB, len)
        posB += len
      } else {
        posB += ins
      }
      posA += len
    }
  }

  /// Iterate over the ranges changed by these changes. (See
  /// [`ChangeSet.iterChanges`](#state.ChangeSet.iterChanges) for a
  /// variant that also provides you with the inserted text.)
  iterChangedRanges(f: (fromA: number, toA: number, fromB: number, toB: number) => void, individual = false) {
    iterChanges(this, f, individual)
  }

  /// Get the inverted form of thes changes.
  get invertedDesc() {
    let sections = []
    for (let i = 0; i < this.sections.length;) {
      let len = this.sections[i++], ins = this.sections[i++]
      if (ins < 0) sections.push(len, ins)
      else sections.push(ins, len)
    }
    return new ChangeDesc(sections)
  }

  /// Compute the combined effect of applying another set of changes
  /// after this one. The length of the document after this set should
  /// match the length before `other`.
  composeDesc(other: ChangeDesc) { return this.empty ? other : other.empty ? this : composeSets(this, other) }

  /// Map this description, which should start with the same document
  /// as `other`, over another set of changes, so that it can be
  /// applied after it.
  mapDesc(other: ChangeDesc, before = false): ChangeDesc { return other.empty ? this : mapSet(this, other, before) }

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
    let posA = 0, posB = 0
    for (let i = 0; i < this.sections.length;) {
      let len = this.sections[i++], ins = this.sections[i++], endA = posA + len
      if (ins < 0) {
        if (endA > pos) return posB + (pos - posA)
        posB += len
      } else {
        if (mode != MapMode.Simple && endA >= pos &&
            (mode == MapMode.TrackDel && posA < pos && endA > pos ||
             mode == MapMode.TrackBefore && posA < pos ||
             mode == MapMode.TrackAfter && endA > pos)) return -1
        if (endA > pos || endA == pos && assoc < 0 && !len)
          return pos == posA || assoc < 0 ? posB : posB + ins
        posB += ins
      }
      posA = endA
    }
    if (pos > posA) throw new RangeError(`Position ${pos} is out of range for changeset of length ${posA}`)
    return posB
  }

  /// Map a position in a way that reliably produces the same position
  /// for a sequence of changes, regardless of the order in which they
  /// were [mapped](#state.ChangeSet.map) and applied. This will map a
  /// position to the start (or end) through _all_ adjacent changes
  /// next to it, and often produces more surprising results than
  /// [`mapPos`](#state.ChangeDesc.mapPos). But it can be useful in
  /// cases where it is important that all clients in a collaborative
  /// setting end up doing the precise same mapping.
  mapPosStable(pos: number, side = -1) {
    let posA = 0, posB = 0, lastB = 0
    for (let i = 0; i < this.sections.length;) {
      let len = this.sections[i++], ins = this.sections[i++], endA = posA + len
      if (ins < 0) {
        if (endA > pos) return posB + Math.max(0, pos - posA)
        lastB = posB += len
      } else {
        if (side <= 0 && endA >= pos) return lastB
        posB += ins
      }
      posA = endA
    }
    return posB
  }

  /// Check whether these changes touch a given range. When one of the
  /// changes entirely covers the range, the string `"cover"` is
  /// returned.
  touchesRange(from: number, to: number): boolean | "cover" {
    for (let i = 0, pos = 0; i < this.sections.length && pos <= to;) {
      let len = this.sections[i++], ins = this.sections[i++], end = pos + len
      if (ins >= 0 && pos <= to && end >= from) return pos < from && end > to ? "cover" : true
      pos = end
    }
    return false
  }

  /// @internal
  toString() {
    let result = ""
    for (let i = 0; i < this.sections.length;) {
      let len = this.sections[i++], ins = this.sections[i++]
      result += (result ? " " : "") + len + (ins >= 0 ? ":" + ins : "")
    }
    return result
  }
}

/// This type is used as argument to
/// [`EditorState.changeSet`](#state.EditorState.changeSet) and in the
/// [`changes` field](#state.TransactionSpec.changes) of transaction
/// specs to succinctly describe document changes. It may either be a
/// plain object describing a change (a deletion, insertion, or
/// replacement, depending on which fields are present), a [change
/// set](#state.ChangeSet), or an array of change specs.
export type ChangeSpec =
  {from: number, to?: number, insert?: string | Text} |
  ChangeSet |
  readonly ChangeSpec[]

/// A change set represents a group of modifications to a document. It
/// stores the document length, and can only be applied to documents
/// with exactly that length.
export class ChangeSet extends ChangeDesc {
  /// @internal
  constructor(
    sections: readonly number[],
    /// @internal
    readonly inserted: readonly Text[]
  ) {
    super(sections)
  }

  /// Apply the changes to a document, returning the modified
  /// document.
  apply(doc: Text) {
    if (this.length != doc.length) throw new RangeError("Applying change set to a document with the wrong length")
    iterChanges(this, (fromA, toA, fromB, _toB, text) => doc = doc.replace(fromB, fromB + (toA - fromA), text), false)
    return doc
  }

  /// Map this set, which should start with the same document as
  /// `other`, over another set of changes, so that it can be applied
  /// after it. When `before` is true, map as if the changes in
  /// `other` happened before the ones in `this`.
  mapDesc(other: ChangeDesc, before = false): ChangeDesc { return mapSet(this, other, before, true) }

  /// Given the document as it existed _before_ the changes, return a
  /// change set that represents the inverse of this set, which could
  /// be used to go from the document created by the changes back to
  /// the document as it existed before the changes.
  invert(doc: Text) {
    let sections = this.sections.slice(), inserted = []
    for (let i = 0, pos = 0; i < sections.length; i += 2) {
      let len = sections[i], ins = sections[i + 1]
      if (ins >= 0) {
        sections[i] = ins; sections[i + 1] = len
        let index = i >> 1
        while (inserted.length < index) inserted.push(Text.empty)
        inserted.push(len ? doc.slice(pos, pos + len) : Text.empty)
      }
      pos += len
    }
    return new ChangeSet(sections, inserted)
  }

  // Combine two subsequent change sets into a single set. `other`
  // must start in the document produced by `this`. If `this` goes
  // `docA` → `docB` and `other` represents `docB` → `docC`, the
  // returned value will represent the change `docA` → `docC`.
  compose(other: ChangeSet) { return this.empty ? other : other.empty ? this : composeSets(this, other, true) }

  // Given another change set starting in the same document, maps this
  // change set over the other, producing a new change set that can be
  // applied to the document produced by applying `other`. When
  // `before` is `true`, order changes as if `this` comes before
  // `other`, otherwise (the default) treat `other` as coming first.
  map(other: ChangeDesc, before = false): ChangeSet { return other.empty ? this : mapSet(this, other, before, true) }

  /// Iterate over the changed ranges in the document, calling `f` for
  /// each.
  iterChanges(f: (fromA: number, toA: number, fromB: number, toB: number, inserted: Text) => void, individual = false) {
    iterChanges(this, f, individual)
  }

  /// Get a [change description](#text.ChangeDesc) for this change
  /// set.
  get desc() { return new ChangeDesc(this.sections) }

  /// @internal
  filter(ranges: readonly number[]) {
    let resultSections: number[] = [], resultInserted: Text[] = [], filteredSections: number[] = []
    let iter = new SectionIter(this)
    done: for (let i = 0, pos = 0;;) {
      let next = i == ranges.length ? 1e9 : ranges[i++]
      while (pos < next || pos == next && iter.len == 0) {
        if (iter.done) break done
        let len = Math.min(iter.len, next - pos)
        addSection(filteredSections, len, -1)
        let ins = iter.ins == -1 ? -1 : iter.off == 0 ? iter.ins : 0
        addSection(resultSections, len, ins)
        if (ins > 0) addInsert(resultInserted, resultSections, iter.text)
        iter.forward(len)
        pos += len
      }
      let end = ranges[i++]
      while (pos < end) {
        if (iter.done) break done
        let len = Math.min(iter.len, end - pos)
        addSection(resultSections, len, -1)
        addSection(filteredSections, len, iter.ins == -1 ? -1 : iter.off == 0 ? iter.ins : 0)
        iter.forward(len)
        pos += len
      }
    }
    return {changes: new ChangeSet(resultSections, resultInserted),
            filtered: new ChangeDesc(filteredSections)}
  }

  /// Create a change set for the given changes, for a document of the
  /// given length, using `lineSep` as line separator.
  static of(changes: ChangeSpec, length: number, lineSep?: string): ChangeSet {
    let sections: number[] = [], inserted: Text[] = [], pos = 0
    let total: ChangeSet | null = null

    function flush(force = false) {
      if (!force && !sections.length) return
      if (pos < length) addSection(sections, length - pos, -1)
      let set = new ChangeSet(sections, inserted)
      total = total ? total.compose(set.map(total)) : set
      sections = []; inserted = []; pos = 0
    }
    function process(spec: ChangeSpec) {
      if (Array.isArray(spec)) {
        for (let sub of spec) process(sub)
      } else if (spec instanceof ChangeSet) {
        if (spec.length != length)
          throw new RangeError(`Mismatched change set length (got ${spec.length}, expected ${length})`)
        flush()
        total = total ? total.compose(spec.map(total)) : spec
      } else {
        let {from, to = from, insert} = spec as {from: number, to?: number, insert?: string | Text}
        if (from > to || from < 0 || to > length)
          throw new RangeError(`Invalid change range ${from} to ${to} (in doc of length ${length})`)
        let insText = !insert ? Text.empty : typeof insert == "string" ? Text.of(insert.split(lineSep || DefaultSplit)) : insert
        let insLen = insText.length
        if (from == to && insLen == 0) return
        if (from < pos) flush()
        if (from > pos) addSection(sections, from - pos, -1)
        addSection(sections, to - from, insLen)
        addInsert(inserted, sections, insText)
        pos = to
      }
    }

    process(changes)
    flush(!total)
    return total!
  }

  /// Create an empty changeset of the given length.
  static empty(length: number) {
    return new ChangeSet(length ? [length, -1] : [], [])
  }
}

function addSection(sections: number[], len: number, ins: number, forceJoin = false) {
  if (len == 0 && ins <= 0) return
  let last = sections.length - 2
  if (last >= 0 && ins <= 0 && ins == sections[last + 1]) sections[last] += len
  else if (len == 0 && sections[last] == 0) sections[last + 1] += ins
  else if (forceJoin) { sections[last] += len; sections[last + 1] += ins }
  else sections.push(len, ins)
}

function addInsert(values: Text[], sections: readonly number[], value: Text) {
  if (value.length == 0) return
  let index = (sections.length - 2) >> 1
  if (index < values.length) {
    values[values.length - 1] = values[values.length - 1].append(value)
  } else {
    while (values.length < index) values.push(Text.empty)
    values.push(value)
  }
}

function iterChanges(desc: ChangeDesc,
                     f: (fromA: number, toA: number, fromB: number, toB: number, text: Text) => void,
                     individual: boolean) {
  let inserted = (desc as ChangeSet).inserted
  for (let posA = 0, posB = 0, i = 0; i < desc.sections.length;) {
    let len = desc.sections[i++], ins = desc.sections[i++]
    if (ins < 0) {
      posA += len; posB += len
    } else {
      let endA = posA, endB = posB, text = Text.empty
      for (;;) {
        endA += len; endB += ins
        if (ins && inserted) text = text.append(inserted[(i - 2) >> 1])
        if (individual || i == desc.sections.length || desc.sections[i + 1] < 0) break
        len = desc.sections[i++]; ins = desc.sections[i++]
      }
      f(posA, endA, posB, endB, text)
      posA = endA; posB = endB
    }
  }
}

function mapSet(setA: ChangeSet, setB: ChangeDesc, before: boolean, mkSet: true): ChangeSet
function mapSet(setA: ChangeDesc, setB: ChangeDesc, before: boolean): ChangeDesc
function mapSet(setA: ChangeDesc, setB: ChangeDesc, before: boolean, mkSet = false): ChangeSet | ChangeDesc {
  let sections: number[] = [], insert: Text[] | null = mkSet ? [] : null
  let a = new SectionIter(setA), b = new SectionIter(setB)
  for (let posA = 0, posB = 0;;) {
    if (a.ins == -1) {
      posA += a.len
      a.next()
    } else if (b.ins == -1 && posB < posA) {
      let skip = Math.min(b.len, posA - posB)
      b.forward(skip)
      addSection(sections, skip, -1)
      posB += skip
    } else if (b.ins >= 0 && (a.done || posB < posA || posB == posA && (b.len < a.len || b.len == a.len && !before))) {
      addSection(sections, b.ins, -1)
      while (posA > posB && !a.done && posA + a.len < posB + b.len) {
        posA += a.len
        a.next()
      }
      posB += b.len
      b.next()
    } else if (a.ins >= 0) {
      let len = 0, end = posA + a.len
      for (;;) {
        if (b.ins >= 0 && posB > posA && posB + b.len < end) {
          len += b.ins
          posB += b.len
          b.next()
        } else if (b.ins == -1 && posB < end) {
          let skip = Math.min(b.len, end - posB)
          len += skip
          b.forward(skip)
          posB += skip
        } else {
          break
        }
      }
      addSection(sections, len, a.ins)
      if (insert) addInsert(insert, sections, a.text)
      posA = end
      a.next()
    } else if (a.done && b.done) {
      return insert ? new ChangeSet(sections, insert) : new ChangeDesc(sections)
    } else {
      throw new Error("Mismatched change set lengths")
    }
  }
}

function composeSets(setA: ChangeSet, setB: ChangeSet, mkSet: true): ChangeSet
function composeSets(setA: ChangeDesc, setB: ChangeDesc): ChangeDesc
function composeSets(setA: ChangeDesc, setB: ChangeDesc, mkSet = false): ChangeDesc {
  let sections: number[] = []
  let insert: Text[] | null = mkSet ? [] : null
  let a = new SectionIter(setA), b = new SectionIter(setB)
  for (let open = false;;) {
    if (a.done && b.done) {
      return insert ? new ChangeSet(sections, insert) : new ChangeDesc(sections)
    } else if (a.ins == 0) { // Deletion in A
      addSection(sections, a.len, 0)
      a.next()
    } else if (b.len == 0 && !b.done) { // Insertion in B
      addSection(sections, 0, b.ins)
      if (insert) addInsert(insert, sections, b.text)
      b.next()
    } else if (a.done || b.done) {
      throw new Error("Mismatched change set lengths")
    } else {
      let len = Math.min(a.len2, b.len), sectionLen = sections.length
      if (a.ins == -1 && b.ins == -1) {
        addSection(sections, len, -1)
      } else if (a.ins == -1) {
        addSection(sections, len, b.off ? 0 : b.ins, open)
        if (insert && !b.off) addInsert(insert, sections, b.text)
      } else if (b.ins == -1) {
        addSection(sections, a.off ? 0 : a.len, len, open)
        if (insert) addInsert(insert, sections, a.textBit(len))
      } else {
        addSection(sections, a.off ? 0 : a.len, b.off ? 0 : b.ins, open)
        if (insert && !b.off) addInsert(insert, sections, b.text)
      }
      open = (a.ins > len || b.ins >= 0 && b.len > len) && (open || sections.length > sectionLen)
      a.forward2(len)
      b.forward(len)
    }
  }
}

class SectionIter {
  i = 0
  len!: number
  off!: number
  ins!: number

  constructor(readonly set: ChangeDesc) {
    this.next()
  }

  next() {
    let {sections} = this.set
    if (this.i < sections.length) {
      this.len = sections[this.i++]
      this.ins = sections[this.i++]
    } else {
      this.len = 0; this.ins = -2
    }
    this.off = 0
  }

  get done() { return this.ins == -2 }

  get len2() { return this.ins == -1 ? this.len : this.ins }

  get text() {
    let {inserted} = this.set as ChangeSet, index = (this.i - 2) >> 1
    return index >= inserted.length ? Text.empty : inserted[index]
  }

  textBit(len?: number) {
    let {inserted} = this.set as ChangeSet, index = (this.i - 2) >> 1
    return index >= inserted.length && !len ? Text.empty
      : inserted[index].slice(this.off, len == null ? undefined : this.off + len)
  }

  forward(len: number) {
    if (len == this.len) this.next()
    else { this.len -= len; this.off += len }
  }

  forward2(len: number) {
    if (this.ins == -1) this.forward(len)
    else if (len == this.ins) this.next()
    else { this.ins -= len; this.off += len }
  }
}
