import {Text} from "../../doc/src"

const empty: ReadonlyArray<any> = []

export enum MapMode { Simple, TrackDel, TrackBefore, TrackAfter }

export interface Mapping {
  mapPos(pos: number, bias?: number, mode?: MapMode): number
}

export class ChangeDesc implements Mapping {
  constructor(public readonly from: number, public readonly to: number, public readonly length: number) {}

  get invertedDesc() { return new ChangeDesc(this.from, this.from + this.length, this.to - this.from) }

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

  toJSON(): any { return this }

  static fromJSON(json: any) {
    if (!json || typeof json.from != "number" || typeof json.to != "number" || typeof json.length != "number")
      throw new RangeError("Invalid JSON representation for ChangeDesc")
    return new ChangeDesc(json.from, json.to, json.length)
  }
}

export class Change extends ChangeDesc {
  constructor(public readonly from: number, public readonly to: number, public readonly text: ReadonlyArray<string>) {
    super(from, to, textLength(text))
  }

  invert(doc: Text): Change {
    return new Change(this.from, this.from + this.length, doc.sliceLines(this.from, this.to))
  }

  apply(doc: Text): Text {
    return doc.replace(this.from, this.to, this.text)
  }

  map(mapping: Mapping): Change | null {
    let from = mapping.mapPos(this.from, 1), to = mapping.mapPos(this.to, -1)
    return from > to ? null : new Change(from, to, this.text)
  }

  get desc() { return new ChangeDesc(this.from, this.to, this.length) }

  toJSON(): any {
    return {from: this.from, to: this.to, text: this.text}
  }

  static fromJSON(json: any) {
    if (!json || typeof json.from != "number" || typeof json.to != "number" ||
        !Array.isArray(json.text) || json.text.some((val: any) => typeof val != "string"))
      throw new RangeError("Invalid JSON representation for Change")
    return new Change(json.from, json.to, json.text)
  }
}

function textLength(text: ReadonlyArray<string>) {
  let length = -1
  for (let line of text) length += line.length + 1
  return length
}

export class ChangeSet<C extends ChangeDesc = Change> implements Mapping {
  constructor(readonly changes: ReadonlyArray<C>,
              readonly mirror: ReadonlyArray<number> = empty) {}

  get length(): number {
    return this.changes.length
  }

  getMirror(n: number): number | null {
    for (let i = 0; i < this.mirror.length; i++)
      if (this.mirror[i] == n) return this.mirror[i + (i % 2 ? -1 : 1)]
    return null
  }

  append(change: C, mirror?: number): ChangeSet<C> {
    return new ChangeSet(this.changes.concat(change),
                         mirror != null ? this.mirror.concat(this.length, mirror) : this.mirror)
  }

  appendSet(changes: ChangeSet<C>): ChangeSet<C> {
    return changes.length == 0 ? this :
      this.length == 0 ? changes :
      new ChangeSet(this.changes.concat(changes.changes),
                    this.mirror.concat(changes.mirror.map(i => i + this.length)))
  }

  static empty: ChangeSet<any> = new ChangeSet(empty)

  mapPos(pos: number, bias: number = -1, mode: MapMode = MapMode.Simple): number {
    return this.mapInner(pos, bias, mode, 0, this.length)
  }

  /** @internal */
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

  partialMapping(from: number, to: number = this.length): Mapping {
    if (from == 0 && to == this.length) return this
    return new PartialMapping(this, from, to)
  }

  changedRanges(): ChangedRange[] {
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

  get desc(): ChangeSet<ChangeDesc> {
    if (this.changes.length == 0 || this.changes[0] instanceof ChangeDesc) return this
    return new ChangeSet(this.changes.map(ch => (ch as any).desc), this.mirror)
  }

  toJSON(): any {
    let changes = this.changes.map(change => change.toJSON())
    return this.mirror.length == 0 ? changes : {mirror: this.mirror, changes}
  }

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

export class ChangedRange {
  constructor(readonly fromA: number, readonly toA: number,
              readonly fromB: number, readonly toB: number) {}

  join(other: ChangedRange): ChangedRange {
    return new ChangedRange(Math.min(this.fromA, other.fromA), Math.max(this.toA, other.toA),
                            Math.min(this.fromB, other.fromB), Math.max(this.toB, other.toB))
  }

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

  subtractFromSet(set: ChangedRange[]): ChangedRange[] {
    for (let i = 0; i < set.length; i++) {
      let range = set[i]
      if (range.fromA >= this.toA && range.fromB >= this.toB) break
      if (range.toA <= this.fromA && range.toB <= this.fromB) continue
      let replace = []
      if (range.fromA < this.fromA || range.fromB < this.fromB)
        replace.push(new ChangedRange(range.fromA, this.fromA, range.fromB, this.fromB))
      if (range.toA > this.toA || range.toB > this.toB)
        replace.push(new ChangedRange(this.toA, range.toA, range.toB, this.toB))
      set.splice(i, 1, ...replace)
      i = i + replace.length - 1
    }
    return set
  }

  get lenDiff() { return (this.toB - this.fromB) - (this.toA - this.fromA) }

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
