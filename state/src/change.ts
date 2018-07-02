import {Text} from "../../doc/src/text"

const empty: ReadonlyArray<any> = []

export class Change {
  constructor(public readonly from: number, public readonly to: number, public readonly text: string) {}

  invert(doc: Text): Change {
    return new Change(this.from, this.from + this.text.length, doc.slice(this.from, this.to))
  }

  apply(doc: Text): Text {
    return doc.replace(this.from, this.to, this.text)
  }
}

export interface Mapping {
  mapPos(pos: number, bias?: number, trackDel?: boolean): number
}

export class ChangeSet implements Mapping {
  constructor(readonly changes: ReadonlyArray<Change>,
              readonly mirror: ReadonlyArray<number> = empty) {}

  get length(): number {
    return this.changes.length
  }

  getMirror(n: number): number | null {
    for (let i = 0; i < this.mirror.length; i++)
      if (this.mirror[i] == n) return this.mirror[i + (i % 2 ? -1 : 1)]
    return null
  }

  append(change: Change, mirror?: number): ChangeSet {
    return new ChangeSet(this.changes.concat(change),
                         mirror != null ? this.mirror.concat(this.length, mirror) : this.mirror)
  }

  static empty: ChangeSet = new ChangeSet(empty)

  mapPos(pos: number, bias: number = -1, trackDel: boolean = false): number {
    return this.mapInner(pos, bias, trackDel, 0, this.length)
  }

  /** @internal */
  mapInner(pos: number, bias: number, trackDel: boolean, fromI: number, toI: number): number {
    let dir = toI < fromI ? -1 : 1
    let recoverables: {[key: number]: number} | null = null
    let hasMirrors = this.mirror.length > 0, rec, mirror
    for (let i = fromI - (dir < 0 ? 1 : 0), endI = toI - (dir < 0 ? 1 : 0); i != endI; i += dir) {
      let {from, to, text: {length}} = this.changes[i]
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
        if (trackDel) return -1
        pos = bias < 0 ? from : from + length
      } else {
        pos = (from == to ? bias < 0 : pos == from) ? from : from + length
      }
    }
    return pos
  }

  partialMapping(from: number, to: number = this.length): Mapping {
    if (from == 0 && to == this.length) return this
    return new PartialMapping(this, from, to)
  }
}

class PartialMapping implements Mapping {
  constructor(readonly changes: ChangeSet, readonly from: number, readonly to: number) {}
  mapPos(pos: number, bias: number = -1, trackDel: boolean = false): number {
    return this.changes.mapInner(pos, bias, trackDel, this.from, this.to)
  }
}
    
