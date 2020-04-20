import {textLength, sliceText} from "./text"

// Internally, change sections are represented by pairs of integers,
// with the type in the first value and its length in the second.
const enum Type {
  Keep = 0,
  Del = 1,
  Ins = 2
}

export type ChangeSpec<Insert = readonly string[]> =
  {insert: Insert, at: number} |
  {delete: number, to: number} |
  readonly ChangeSpec<Insert>[]

export class ChangeSet {
  /// @internal
  constructor(
    /// @internal
    readonly sections: readonly number[],
    /// @internal
    readonly inserted: readonly (readonly string[] | null)[]
  ) {}

  /// The length of the document before the change.
  get length() { return getLen(this.sections, Type.Ins) }

  /// The length of the document after the change.
  get newLength() { return getLen(this.sections, Type.Del) }

  // Combine two subsequent change sets into a single set. `other`
  // must start in the document produced by `this`. If `this` goes
  // `docA` → `docB` and `other` represents `docB` → `docC`, the
  // returned value will represent the change `docA` → `docC`.
  compose(other: ChangeSet): ChangeDesc { return joinSets(this, other, joinCompose) }

  /// Combine two change sets that start in the same document to
  /// create a change set that represents the union of both.
  combine(other: ChangeSet) { return joinSets(this, other, joinCombine) }

  // Given another change set starting in the same document, maps this
  // change set over the other, producing a new change set that can be
  // applied to the document produced by applying `other`. When
  // `before` is `true`, order changes as if `this` comes before
  // `other`, otherwise (the default) treat `other` as coming first.
  map(other: ChangeSet, before = false) { return joinSets(this, other, before ? joinMapBefore : joinMapAfter) }

  /// Map a position through this set of changes, returning the
  /// corresponding position in the new document.
  mapPos(pos: number, assoc = -1) { return mapThrough(this.sections, pos, assoc) }

  /// Create a change set for the given collection of changes.
  static of(length: number, changes: ChangeSpec<readonly string[]>): ChangeSet {
    if (Array.isArray(changes)) {
      return changes.length ? flatten(changes.map(ch => ChangeSet.of(length, ch))) :
        new ChangeSet(length ? [Type.Keep, length] : empty, empty)
    } else {
      let sections: number[] = [], inserted = empty, change = changes as any
      if (change.delete != null) {
        addSection(sections, Type.Keep, change.delete)
        addSection(sections, Type.Del, change.to - change.delete)
        addSection(sections, Type.Keep, length - change.to)
      } else {
        let insertLen = textLength(change.insert)
        if (insertLen) inserted = [change.insert]
        addSection(sections, Type.Keep, change.at)
        addSection(sections, Type.Ins, insertLen)
        addSection(sections, Type.Keep, length - change.at)
      }
      return new ChangeSet(sections, inserted)
    }
  }
}

export class ChangeDesc {
  /// @internal
  constructor(
    /// @internal
    readonly sections: readonly number[],
  ) {}

  get length() { return getLen(this.sections, Type.Ins) }

  get newLength() { return getLen(this.sections, Type.Del) }

  compose(other: ChangeDesc): ChangeDesc { return joinSets(this, other, joinCompose) }

  combine(other: ChangeDesc) { return joinSets(this, other, joinCombine) }

  map(other: ChangeDesc, before = false) { return joinSets(this, other, before ? joinMapBefore : joinMapAfter) }

  mapPos(pos: number, assoc = -1) { return mapThrough(this.sections, pos, assoc) }

  /// @internal
  toString() {
    let result = ""
    for (let i = 0, s = this.sections; i < s.length; i += 2)
      result += (s[i] == Type.Del ? "d" : s[i] == Type.Keep ? "k" : "i") + s[i + 1]
    return result
  }

  /// @internal
  static of(sections: readonly ["keep" | "ins" | "del", number][]) {
    let values = []
    for (let [type, len] of sections) values.push(type == "keep" ? Type.Keep : type == "ins" ? Type.Ins : Type.Del, len)
    return new ChangeDesc(values)
  }
}

function getLen(sections: readonly number[], ignore: Type) {
  let length = 0
  for (let i = 0; i < sections.length; i += 2) if (sections[i] != ignore) length += sections[i + 1]
  return length
}

function mapThrough(sections: readonly number[], pos: number, assoc: number) {
  // FIXME mapping modes
  let result = pos
  for (let i = 0, off = 0; i < sections.length;) {
    let type = sections[i++], len = sections[i++]
    if (type == Type.Ins) {
      if (off < pos || assoc > 0) result += len
    } else if (type == Type.Del) {
      result -= Math.min(len, pos - off)
      off += len
    } else {
      off += len
    }
    if (off > pos) break
  }
  return result
}

const empty: readonly any[] = []

// Recursively combine a set of changes
function flatten(descs: ChangeSet[], from = 0, to = descs.length): ChangeSet {
  if (to == from + 1) return descs[from]
  let mid = (from + to) >> 1
  return flatten(descs, from, mid).combine(flatten(descs, mid, to))
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

interface Joinable {
  sections: readonly number[],
  inserted?: readonly (readonly string[] | null)[]
}

function joinSets<T extends Joinable>(a: T, b: T, f: (typeA: number, typeB: number) => number): T {
  let sections: number[] = []
  let insert: null | (readonly string[] | null)[] = a.inserted ? [] : null
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
      if (type == Type.Ins && insert) {
        let value = join & Join.A || !(join & Join.B) || typeA == Type.Ins
          ? takeInsert(a.inserted!, iA, offA, lenA) : takeInsert(b.inserted!, iB, offB, lenB)
        let index = (sections.length - 2) >> 1
        if (insert.length == index - 1) { // Already exists
          insert[index - 1] = appendText(insert[index - 1] as readonly string[], value)
        } else {
          while (insert.length < index - 1) insert.push(null)
          insert.push(value)
        }
      }
    }
    if (len == 0) {
      if (lenA != lenB) throw new RangeError("Mismatched change set lengths")
      return new (a.constructor as any)(sections, insert)
    }
  }
}

function takeInsert(array: readonly (readonly string[] | null)[], index: number, off: number, len: number): readonly string[] {
  let value = array[index] as readonly string[]
  return off < 0 || off + len < textLength(value) ? sliceText(value, off, off + len) : value
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
