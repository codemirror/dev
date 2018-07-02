import {Mapping} from "./change"

export class SelectionRange {
  constructor(public readonly anchor: number, public readonly head: number = anchor) {}

  get from(): number { return Math.min(this.anchor, this.head) }
  get to(): number { return Math.max(this.anchor, this.head) }
  get empty(): boolean { return this.anchor == this.head }

  map(mapping: Mapping): SelectionRange {
    let anchor = mapping.mapPos(this.anchor), head = mapping.mapPos(this.head)
    if (anchor == this.anchor && head == this.head) return this
    else return new SelectionRange(anchor, head)
  }

  eq(other: SelectionRange): boolean {
    return this.anchor == other.anchor && this.head == other.head
  }
}

export class EditorSelection {
  /** @internal */
  constructor(readonly ranges: ReadonlyArray<SelectionRange>,
              readonly primaryIndex: number) {}

  map(mapping: Mapping): EditorSelection {
    return EditorSelection.create(this.ranges.map(r => r.map(mapping)), this.primaryIndex)
  }

  eq(other: EditorSelection): boolean {
    if (this.ranges.length != other.ranges.length ||
        this.primaryIndex != other.primaryIndex) return false
    for (let i = 0; i < this.ranges.length; i++)
      if (!this.ranges[i].eq(other.ranges[i])) return false
    return true
  }

  get primary(): SelectionRange { return this.ranges[this.primaryIndex] }

  static single(anchor: number, head: number = anchor) {
    return new EditorSelection([new SelectionRange(anchor, head)], 0)
  }

  static create(ranges: ReadonlyArray<SelectionRange>, primaryIndex: number = 0) {
    for (let pos = 0, i = 0; i < ranges.length; i++) {
      let range = ranges[i]
      if (range.from < pos) return normalized(ranges.slice(), primaryIndex)
      pos = range.to
    }
    return new EditorSelection(ranges, primaryIndex)
  }

  static default: EditorSelection = EditorSelection.single(0)
}

function normalized(ranges: SelectionRange[], primaryIndex: number = 0): EditorSelection {
  let primary = ranges[primaryIndex]
  ranges.sort((a, b) => a.from - b.from)
  primaryIndex = ranges.indexOf(primary)
  for (let i = 1; i < ranges.length; i++) {
    let range = ranges[i], prev = ranges[i - 1]
    if (range.from < prev.to) {
      let from = prev.from, to = Math.max(range.to, prev.to)
      if (i == primaryIndex) primaryIndex--
      ranges.splice(--i, 2, range.anchor > range.head ? new SelectionRange(to, from) : new SelectionRange(from, to))
    }
  }
  return new EditorSelection(ranges, primaryIndex)
}
