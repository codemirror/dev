import {textLength, sliceText} from "./text"

// Internally, change sections are represented by pairs of integers,
// with the type in the first value and its length in the second.
const enum Type {
  Keep = 0,
  Del = 1,
  // With an insert, the data structure might store the index into the
  // insert table in the higher bits.
  Ins = 2,
  Mask = 3
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
    readonly inserted: readonly (readonly string[])[]
  ) {}

  /// The length of the document before the change.
  get length() { return getLen(this.sections, Type.Ins) }

  /// The length of the document after the change.
  get newLength() { return getLen(this.sections, Type.Del) }

  // Combine two subsequent change sets into a single set. `other`
  // must start in the document produced by `this`. If `this` goes
  // `docA` → `docB` and `other` represents `docB` → `docC`, the
  // returned value will represent the change `docA` → `docC`.
  compose(other: ChangeSet) {
    let sections: number[] = []
    let inserted: (readonly string[])[] = []
    let insIndexA = 0, insIndexB = 0, insOffA = 0
    iterSets(this, other, (typeA, lenA, typeB, lenB) => {
      if (typeA == Type.Del) {
        addSection(sections, typeA, lenA)
        return Next.A
      } else if (typeB == Type.Ins) {
        addInserted(inserted, other.inserted![insIndexB++], sections)
        addSection(sections, typeB, lenB)
        return Next.B
      } else if (lenA == 0 || lenB == 0) {
        return Next.Stop
      } else {
        let len = Math.min(lenA, lenB)
        if (typeA == Type.Ins) {
          if (typeB != Type.Del)
            addInserted(inserted, sliceText(this.inserted[insIndexA], insOffA, insOffA + len), sections)
          insOffA += len
          if (insOffA == textLength(this.inserted[insIndexA])) {
            insIndexA++
            insOffA = 0
          }
        }
        if (typeA != Type.Ins || typeB != Type.Del) // These cancel each other
          addSection(sections, typeA == Type.Keep ? typeB : typeA, len)
        return len
      }
    })
    return new ChangeSet(sections, inserted)
  }

  /// Combine two change sets that start in the same document to
  /// create a change set that represents the union of both.
  combine(other: ChangeSet) {
    let sections: number[] = []
    let inserted: (readonly string[])[] = [], insIndexA = 0, insIndexB = 0
    iterSets(this, other, (typeA, lenA, typeB, lenB) => {
      if (typeA == Type.Ins) {
        if (inserted) addInserted(inserted, this.inserted![insIndexA++], sections)
        addSection(sections, typeA, lenA)
        return Next.A
      } else if (typeB == Type.Ins) {
        if (inserted) addInserted(inserted, other.inserted![insIndexB++], sections)
        addSection(sections, typeB, lenB)
        return Next.B
      } else if (lenA == 0 || lenB == 0) {
        return Next.Stop
      } else {
        let len = Math.min(lenA, lenB)
        addSection(sections, typeA == Type.Del ? typeA : typeB, len)
        return len
      }
    })
    return new ChangeSet(sections, inserted)
  }

  // Given another change set starting in the same document, maps this
  // change set over the other, producing a new change set that can be
  // applied to the document produced by applying `other`. When
  // `before` is `true`, order changes as if `this` comes before
  // `other`, otherwise (the default) treat `other` as coming first.
  map(other: ChangeSet, before = false) {
    let sections: number[] = []
    let inserted: (readonly string[])[] = [], insIndexA = 0, insIndexB = 0
    iterSets(this, other, (typeA, lenA, typeB, lenB) => {
      if (typeB == Type.Ins && (!before || typeA != Type.Ins)) {
        if (inserted) addInserted(inserted, other.inserted![insIndexB++], sections)
        addSection(sections, Type.Keep, lenB)
        return Next.B
      } else if (typeA == Type.Ins) {
        if (inserted) addInserted(inserted, this.inserted![insIndexA++], sections)
        addSection(sections, typeA, lenA)
        return Next.A
      } else if (lenA == 0 || lenB == 0) {
        return Next.Stop
      } else {
        let len = Math.min(lenA, lenB)
        if (typeB != Type.Del) addSection(sections, typeA, len)
        return len
      }
    })
    return new ChangeSet(sections, inserted)
  }

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

  compose(other: ChangeDesc): ChangeDesc {
    return joinSets(this, other, (typeA, typeB) => {
      if (typeA == Type.Del) return typeA | Join.A
      if (typeB == Type.Ins) return typeB | Join.B
      if (typeA == Type.Ins && typeB == Type.Del) return Join.Drop
      return typeA == Type.Keep ? typeB : typeA
    })
  }

  combine(other: ChangeDesc) {
    return joinSets(this, other, (typeA, typeB) => {
      if (typeA == Type.Ins) return typeA | Join.A
      if (typeB == Type.Ins) return typeB | Join.B
      return typeA == Type.Del ? typeA : typeB
    })
  }

  map(other: ChangeDesc, before = false) {
    return joinSets(this, other, (typeA, typeB) => {
      if (typeA == Type.Ins && (before || typeB < Type.Ins)) return typeA | Join.A
      if (typeB == Type.Ins) return Type.Keep | Join.B
      return typeB == Type.Del ? Join.Drop : typeA
    })
  }

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
  for (let i = 0; i < sections.length; i += 2) if ((sections[i] & Type.Mask) != ignore) length += sections[i + 1]
  return length
}

function mapThrough(sections: readonly number[], pos: number, assoc: number) {
  // FIXME mapping modes
  let result = pos
  for (let i = 0, off = 0; i < sections.length;) {
    let type = sections[i++] & Type.Mask, len = sections[i++]
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

function addInserted(inserted: (readonly string[])[], value: readonly string[], sections: readonly number[]) {
  if (sections.length && (sections[sections.length - 2] & Type.Mask) == Type.Ins)
    inserted[inserted.length - 1] = appendText(inserted[inserted.length - 1], value)
  else
    inserted.push(value)
}

const enum Join { Drop = 3, A = 4, B = 8 }

interface Joinable {
  sections: readonly number[],
  inserted?: readonly (readonly string[])[]
}

function joinSets<T extends Joinable>(a: T, b: T, f: (typeA: number, typeB: number) => number): ChangeDesc {
  let sections: number[] = []
  let iA = 0, typeA = Type.Keep, lenA = 0
  let iB = 0, typeB = Type.Keep, lenB = 0

  function nextA() {
    if (iA < a.sections.length) {
      typeA = a.sections[iA++] & Type.Mask
      lenA = a.sections[iA++]
    } else {
      typeA = Type.Keep
      lenA = 0
    }
  }
  nextA()

  function nextB() {
    if (iB < b.sections.length) {
      typeB = b.sections[iB++] & Type.Mask
      lenB = b.sections[iB++]
    } else {
      typeB = Type.Keep
      lenB = 0
    }
  }
  nextB()

  for (;;) {
    let join = f(typeA, typeB)
    let len, type = join & Type.Mask
    if (join & Join.A) {
      len = lenA
      nextA()
    } else if (join & Join.B) {
      len = lenB
      nextB()
    } else {
      len = Math.min(lenA, lenB)
      if (!(lenA -= len)) nextA()
      if (!(lenB -= len)) nextB()
    }
    if (type != Join.Drop) addSection(sections, type, len)
    if (len == 0) {
      if (lenA != lenB) throw new RangeError("Mismatched change set lengths")
      return new ChangeDesc(sections)
    }
  }
}

const enum Next { A = -1, B = -2, Stop = 0 }

function iterSets(a: ChangeSet, b: ChangeSet, f: (typeA: number, lenA: number, typeB: number, lenB: number) => number) {
  let aArray = a.sections, iA = 0, typeA = Type.Keep, lenA = 0
  let bArray = b.sections, iB = 0, typeB = Type.Keep, lenB = 0

  for (let move = 0;;) {
    if (move == Next.A || lenA == move) {
      if (iA < aArray.length) {
        typeA = aArray[iA++] & Type.Mask
        lenA = aArray[iA++]
      } else {
        typeA = Type.Keep
        lenA = 0
      }
    } else if (move != Next.B) {
      lenA -= move
    }
    if (move == Next.B || lenB == move) {
      if (iB < bArray.length) {
        typeB = bArray[iB++] & Type.Mask
        lenB = bArray[iB++]
      } else {
        typeB = Type.Keep
        lenB = 0
      }
    } else if (move != Next.A) {
      lenB -= move
    }
    move = f(typeA, lenA, typeB, lenB)
    if (move == Next.Stop) {
      if (lenA == 0 && lenB == 0) break
      throw new RangeError("Mismatched change set lengths")
    }
  }
}
