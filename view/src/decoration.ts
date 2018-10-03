import {Mapping, ChangedRange} from "../../state/src"
import {RangeValue, Range, RangeSet, RangeComparator, RangeIterator} from "../../rangeset/src/rangeset"

export interface RangeDecorationSpec {
  inclusiveStart?: boolean
  inclusiveEnd?: boolean
  attributes?: {[key: string]: string}
  // Shorthand for {attributes: {class: value}}
  class?: string
  lineAttributes?: {[key: string]: string}
  tagName?: string
  collapsed?: boolean | WidgetType<any>
  data?: any
}

export interface PointDecorationSpec {
  side?: number
  lineAttributes?: {[key: string]: string}
  widget?: WidgetType<any>
  data?: any
}

export abstract class WidgetType<T> {
  constructor(readonly spec: T) {}
  abstract toDOM(): HTMLElement;
  eq(spec: T): boolean { return this.spec === spec }

  /** @internal */
  compare(other: WidgetType<any>): boolean {
    return this == other || this.constructor == other.constructor && this.eq(other.spec)
  }

  get estimatedHeight(): number { return -1 }
  ignoreEvent(event: Event): boolean { return true }
}

export type DecorationSet = RangeSet<Decoration>
export type DecoratedRange = Range<Decoration>

export abstract class Decoration implements RangeValue {
  constructor(readonly bias: number, readonly widget: WidgetType<any> | null, public lineAttributes: {[key: string]: string} | null, readonly data: any) {}
  abstract map(mapping: Mapping, from: number, to: number): DecoratedRange | null;

  static range(from: number, to: number, spec: RangeDecorationSpec): DecoratedRange {
    if (from >= to) throw new RangeError("Range decorations may not be empty")
    return new Range(from, to, new RangeDecoration(spec))
  }

  static point(pos: number, spec: PointDecorationSpec): DecoratedRange {
    return new Range(pos, pos, new PointDecoration(spec))
  }

  static set(of: DecoratedRange | ReadonlyArray<DecoratedRange>): DecorationSet {
    return RangeSet.of<Decoration>(of)
  }

  static none = RangeSet.empty as DecorationSet
}

const BIG_BIAS = 2e9

export class RangeDecoration extends Decoration {
  readonly endBias: number
  readonly affectsSpans: boolean
  readonly tagName: string | undefined
  readonly class: string | undefined
  readonly attributes: {[key: string]: string} | undefined
  readonly collapsed: boolean

  constructor(readonly spec: RangeDecorationSpec) {
    super(spec.inclusiveStart === true ? -BIG_BIAS : BIG_BIAS,
          spec.collapsed instanceof WidgetType ? spec.collapsed : null,
          spec.lineAttributes || null,
          spec.data)
    this.endBias = spec.inclusiveEnd == true ? BIG_BIAS : -BIG_BIAS
    this.tagName = spec.tagName
    this.class = spec.class
    this.attributes = spec.attributes
    this.collapsed = !!spec.collapsed
    this.affectsSpans = !!(this.attributes || this.tagName || this.class || this.collapsed)
  }

  map(mapping: Mapping, from: number, to: number): DecoratedRange | null {
    let newFrom = mapping.mapPos(from, this.bias, true), newTo = mapping.mapPos(to, this.endBias, true)
    if (newFrom < 0) {
      if (newTo < 0) return null
      newFrom = this.bias >= 0 ? -(newFrom + 1) : mapping.mapPos(from, 1)
    } else if (newTo < 0) {
      newTo = this.endBias < 0 ? -(newTo + 1) : mapping.mapPos(to, -1)
    }
    return newFrom < newTo ? new Range(newFrom, newTo, this) : null
  }

  eq(other: RangeDecoration): boolean {
    return this == other ||
      this.tagName == other.tagName &&
      this.class == other.class &&
      this.collapsed == other.collapsed &&
      (this.widget == other.widget || !!(this.widget && other.widget && this.widget.compare(other.widget))) &&
      attrsEq(this.attributes, other.attributes) &&
      attrsEq(this.lineAttributes, other.lineAttributes)
  }
}

export class PointDecoration extends Decoration {
  constructor(readonly spec: PointDecorationSpec) {
    super(spec.side || 0, spec.widget || null, spec.lineAttributes || null, spec.data)
  }

  map(mapping: Mapping, from: number, to: number): DecoratedRange | null {
    let pos = mapping.mapPos(from, this.bias, true)
    return pos < 0 ? null : new Range(pos, pos, this)
  }

  eq(other: PointDecoration): boolean {
    return this.bias == other.bias &&
      (this.widget == other.widget || !!(this.widget && other.widget && this.widget.compare(other.widget)))
  }
}

export function attrsEq(a: any, b: any): boolean {
  if (a == b) return true
  if (!a || !b) return false
  let keysA = Object.keys(a), keysB = Object.keys(b)
  if (keysA.length != keysB.length) return false
  for (let key of keysA) {
    if (keysB.indexOf(key) == -1 || a[key] !== b[key]) return false
  }
  return true
}

function compareSets<T>(setA: T[], setB: T[], relevant: (val: T) => boolean, same: (a: T, b: T) => boolean): boolean {
  let countA = 0, countB = 0
  search: for (let value of setA) if (relevant(value)) {
    countA++
    for (let valueB of setB) if (same(value, valueB)) continue search
    return false
  }
  for (let value of setB) if (relevant(value)) countB++
  return countA == countB
}

const MIN_RANGE_GAP = 4

function addRange(from: number, to: number, ranges: number[]) {
  if (ranges[ranges.length - 1] + MIN_RANGE_GAP > from) ranges[ranges.length - 1] = to
  else ranges.push(from, to)
}

export function joinRanges(a: number[], b: number[]): number[] {
  if (a.length == 0) return b
  if (b.length == 0) return a
  let result: number[] = []
  for (let iA = 0, iB = 0;;) {
    if (iA < a.length && (iB == b.length || a[iA] < b[iB]))
      addRange(a[iA++], a[iA++], result)
    else if (iB < b.length)
      addRange(b[iB++], b[iB++], result)
    else
      break
  }
  return result
}

class Changes {
  content: number[] = []
  height: number[] = []
  line: number[] = []
}

class DecorationComparator implements RangeComparator<Decoration> {
  changes: Changes = new Changes
  constructor(private length: number) {}

  compareRange(from: number, to: number, activeA: Decoration[], activeB: Decoration[]) {
    if (!compareSets(activeA as RangeDecoration[], activeB as RangeDecoration[],
                     deco => deco.affectsSpans, (a, b) => a.eq(b)))
      addRange(from, Math.min(to, this.length), this.changes.content)
  }

  compareCollapsed(from: number, to: number, byA: Decoration, byB: Decoration) {
    let wA = byA.widget, wB = byB.widget
    if (wA != wB && !(wA && wB && wA.compare(wB))) {
      addRange(from, to, this.changes.content)
      addRange(from, to, this.changes.height)
    }
  }

  comparePoints(pos: number, pointsA: Decoration[], pointsB: Decoration[]) {
    if (!compareSets(pointsA, pointsB, deco => !!deco.widget, (a, b) => !!b.widget && a.widget!.compare(b.widget))) {
      addRange(pos, pos, this.changes.content)
      addRange(pos, pos, this.changes.height)
    }
  }
}

export function findChangedRanges(a: DecorationSet, b: DecorationSet, diff: ReadonlyArray<ChangedRange>, length: number): Changes {
  let comp = new DecorationComparator(length)
  a.compare(b, diff, comp)
  return comp.changes
}

class HeightDecoScanner implements RangeIterator<Decoration> {
  ranges: number[] = []
  pos: number = 0

  advance(pos: number, active: ReadonlyArray<Decoration>) { this.pos = pos }
  advanceCollapsed(pos: number) { addRange(this.pos, pos, this.ranges); this.pos = pos }
  point(value: Decoration) { addRange(this.pos, this.pos, this.ranges) }
  ignoreRange(value: Decoration) { return true }
  ignorePoint(value: Decoration) { return !value.widget }
}

export function heightRelevantDecorations(decorations: DecorationSet[], ranges: ReadonlyArray<ChangedRange>): number[] {
  let scanner = new HeightDecoScanner
  for (let {fromB, toB} of ranges) if (fromB < toB) {
    scanner.pos = fromB
    RangeSet.iterateSpans(decorations, fromB, toB, scanner)
  }
  return scanner.ranges
}
