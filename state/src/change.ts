import {Text} from "../../doc/src/text"

const empty: ReadonlyArray<any> = []

export interface Mapping {
  mapPos(pos: number, bias?: number, trackDel?: boolean): number
}

export class ChangeDesc implements Mapping {
  constructor(public readonly from: number, public readonly to: number, public readonly length: number) {}

  get invertedDesc() { return new ChangeDesc(this.from, this.from + this.length, this.to - this.from) }

  mapPos(pos: number, bias: number = -1, trackDel: boolean = false): number {
    let {from, to, length} = this
    if (pos < from) return pos
    if (pos > to) return pos + (length - (to - from))
    if (pos == to || pos == from) return (from == to ? bias < 0 : pos == from) ? from : from + length
    pos = from + (bias < 0 ? 0 : length)
    return trackDel ? -pos - 1 : pos
  }
}

export class Change extends ChangeDesc {
  constructor(public readonly from: number, public readonly to: number, public readonly text: ReadonlyArray<string>) {
    super(from, to, textLength(text))
  }

  invert(doc: Text): Change {
    return new Change(this.from, this.from + this.length, doc.slice(this.from, this.to))
  }

  apply(doc: Text): Text {
    return doc.replace(this.from, this.to, this.text)
  }

  map(mapping: Mapping): Change | null {
    let from = mapping.mapPos(this.from, 1), to = mapping.mapPos(this.to, -1)
    return from > to ? null : new Change(from, to, this.text)
  }

  get desc() { return new ChangeDesc(this.from, this.to, this.length) }
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

  mapPos(pos: number, bias: number = -1, trackDel: boolean = false): number {
    return this.mapInner(pos, bias, trackDel, 0, this.length)
  }

  /** @internal */
  mapInner(pos: number, bias: number, trackDel: boolean, fromI: number, toI: number): number {
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
        deleted = true
        pos = bias < 0 ? from : from + length
      } else {
        pos = (from == to ? bias < 0 : pos == from) ? from : from + length
      }
    }
    return trackDel && deleted ? -pos - 1 : pos
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
}

class PartialMapping implements Mapping {
  constructor(readonly changes: ChangeSet<any>, readonly from: number, readonly to: number) {}
  mapPos(pos: number, bias: number = -1, trackDel: boolean = false): number {
    return this.changes.mapInner(pos, bias, trackDel, this.from, this.to)
  }
}

export class ChangedRange {
  constructor(readonly fromA: number, readonly toA: number,
              readonly fromB: number, readonly toB: number) {}

  join(other: ChangedRange): ChangedRange {
    return new ChangedRange(Math.min(this.fromA, other.fromA), Math.max(this.toA, other.toA),
                            Math.min(this.fromB, other.fromB), Math.max(this.toB, other.toB))
  }

  addToSet(set: ChangedRange[]) {
    let i = set.length, me: ChangedRange = this
    for (; i > 0; i--) {
      let range = set[i - 1]
      if (range.fromA > me.toA) continue
      if (range.toA < me.fromA) break
      me = me.join(range)
      set.splice(i - 1, 1)
    }
    set.splice(i, 0, me)
  }
}
