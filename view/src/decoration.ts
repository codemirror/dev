import {ChangeSet, ChangedRange, MapMode} from "../../state/src"
import {RangeValue, Range, RangeSet, RangeComparator, RangeIterator} from "../../rangeset/src/rangeset"
import {attrsEq} from "./attributes"

export interface MarkDecorationSpec {
  inclusive?: boolean
  inclusiveStart?: boolean
  inclusiveEnd?: boolean
  attributes?: {[key: string]: string}
  // Shorthand for {attributes: {class: value}}
  class?: string
  tagName?: string
}

export interface WidgetDecorationSpec {
  widget: WidgetType
  side?: number
  block?: boolean
}

export interface ReplaceDecorationSpec {
  widget?: WidgetType
  inclusive?: boolean
  inclusiveStart?: boolean
  inclusiveEnd?: boolean
  block?: boolean
}

export interface LineDecorationSpec {
  attributes?: {[key: string]: string}
}

export abstract class WidgetType<T = any> {
  constructor(readonly value: T) {}
  abstract toDOM(): HTMLElement;
  eq(value: T): boolean { return this.value === value }
  updateDOM(dom: HTMLElement): boolean { return false }

  /** @internal */
  compare(other: WidgetType): boolean {
    return this == other || this.constructor == other.constructor && this.eq(other.value)
  }

  get estimatedHeight(): number { return -1 }
  ignoreEvent(event: Event): boolean { return true }
}

export type DecorationSet = RangeSet<Decoration>
export type DecoratedRange = Range<Decoration>

const INLINE_BIG_SIDE = 1e8, BLOCK_BIG_SIDE = 2e8

export const enum BlockType { text, widgetBefore, widgetAfter, widgetRange }

export abstract class Decoration implements RangeValue {
  // @internal
  constructor(
    // @internal
    readonly startSide: number,
    // @internal
    readonly endSide: number,
    // @internal
    readonly widget: WidgetType | null,
    readonly spec: any) {}

  get point() { return false }

  get heightRelevant() { return false }

  abstract map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null
  abstract eq(other: Decoration): boolean

  static mark(from: number, to: number, spec: MarkDecorationSpec): DecoratedRange {
    if (from >= to) throw new RangeError("Mark decorations may not be empty")
    return new Range(from, to, new MarkDecoration(spec))
  }

  static widget(pos: number, spec: WidgetDecorationSpec): DecoratedRange {
    let side = spec.side || 0
    if (spec.block) side += (BLOCK_BIG_SIDE + 1) * (side > 0 ? 1 : -1)
    return new Range(pos, pos, new PointDecoration(spec, side, side, !!spec.block, spec.widget))
  }

  static replace(from: number, to: number, spec: ReplaceDecorationSpec): DecoratedRange {
    let block = !!spec.block
    let {start, end} = getInclusive(spec)
    let startSide = block ? -BLOCK_BIG_SIDE * (start ? 2 : 1) : INLINE_BIG_SIDE * (start ? -1 : 1)
    let endSide = block ? BLOCK_BIG_SIDE * (end ? 2 : 1) : INLINE_BIG_SIDE * (end ? 1 : -1)
    if (from > to || (from == to && startSide > 0 && endSide < 0))
      throw new RangeError("Invalid range for replacement decoration")
    return new Range(from, Math.max(from, to), new PointDecoration(spec, startSide, endSide, block, spec.widget || null))
  }

  static line(start: number, spec: LineDecorationSpec): DecoratedRange {
    return new Range(start, start, new LineDecoration(spec))
  }

  static set(of: DecoratedRange | ReadonlyArray<DecoratedRange>): DecorationSet {
    return RangeSet.of<Decoration>(of)
  }

  static none = RangeSet.empty as DecorationSet

  // @internal
  hasHeight() { return this.widget ? this.widget.estimatedHeight > -1 : false }

  // @internal
  mapSimple(mapping: ChangeSet, from: number, to: number) {
    let newFrom = mapping.mapPos(from, this.startSide, MapMode.TrackDel)
    if (from == to && this.startSide == this.endSide) return newFrom < 0 ? null : new Range(newFrom, newFrom, this)
    let newTo = mapping.mapPos(to, this.endSide, MapMode.TrackDel)
    if (newFrom < 0) {
      if (newTo < 0) return null
      newFrom = this.startSide >= 0 ? -(newFrom + 1) : mapping.mapPos(from, 1)
    } else if (newTo < 0) {
      newTo = this.endSide < 0 ? -(newTo + 1) : mapping.mapPos(to, -1)
    }
    return newFrom < newTo ? new Range(newFrom, newTo, this) : null
  }
}

export class MarkDecoration extends Decoration {
  constructor(spec: MarkDecorationSpec) {
    let {start, end} = getInclusive(spec)
    super(INLINE_BIG_SIDE * (start ? -1 : 1),
          INLINE_BIG_SIDE * (end ? 1 : -1),
          null, spec)
  }

  map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null {
    return this.mapSimple(mapping, from, to)
  }

  eq(other: Decoration): boolean {
    return this == other ||
      other instanceof MarkDecoration &&
      this.spec.tagName == other.spec.tagName &&
      this.spec.class == other.spec.class &&
      attrsEq(this.spec.attributes || null, other.spec.attributes || null)
  }
}

export class LineDecoration extends Decoration {
  constructor(spec: LineDecorationSpec) {
    super(-INLINE_BIG_SIDE, -INLINE_BIG_SIDE, null, spec)
  }

  get point() { return true }

  map(mapping: ChangeSet, pos: number): DecoratedRange | null {
    pos = mapping.mapPos(pos, -1, MapMode.TrackBefore)
    return pos < 0 ? null : new Range(pos, pos, this)
  }

  eq(other: Decoration): boolean {
    return other instanceof LineDecoration && attrsEq(this.spec.attributes, other.spec.attributes)
  }
}

export class PointDecoration extends Decoration {
  constructor(spec: any, startSide: number, endSide: number, public block: boolean, widget: WidgetType | null) {
    super(startSide, endSide, widget, spec)
  }

  get point() { return true }

  // Only relevant when this.block == true
  get type() {
    return this.startSide < this.endSide ? BlockType.widgetRange : this.startSide < 0 ? BlockType.widgetBefore : BlockType.widgetAfter
  }

  get heightRelevant() { return this.block || !!this.widget && this.widget.estimatedHeight >= 5 }

  map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null {
    // FIXME make mapping behavior configurable?
    if (this.block) {
      let {type} = this
      let newFrom = type == BlockType.widgetAfter ? mapping.mapPos(from, 1, MapMode.TrackAfter) : mapping.mapPos(from, -1, MapMode.TrackBefore)
      let newTo = type == BlockType.widgetRange ? mapping.mapPos(to, 1, MapMode.TrackAfter) : newFrom
      return newFrom < 0 || newTo < 0 ? null : new Range(newFrom, newTo, this)
    } else {
      return this.mapSimple(mapping, from, to)
    }
  }

  eq(other: Decoration): boolean {
    return other instanceof PointDecoration &&
      widgetsEq(this.widget, other.widget) &&
      this.block == other.block &&
      this.startSide == other.startSide && this.endSide == other.endSide
  }
}

function getInclusive(spec: {inclusive?: boolean, inclusiveStart?: boolean, inclusiveEnd?: boolean}): {start: boolean, end: boolean} {
  let {inclusiveStart: start, inclusiveEnd: end} = spec
  if (start == null) start = spec.inclusive
  if (end == null) end = spec.inclusive
  return {start: start || false, end: end || false}
}

export function widgetsEq(a: WidgetType | null, b: WidgetType | null): boolean {
  return a == b || !!(a && b && a.compare(b))
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
}

class DecorationComparator implements RangeComparator<Decoration> {
  changes: Changes = new Changes
  constructor() {}

  compareRange(from: number, to: number, activeA: Decoration[], activeB: Decoration[]) {
    addRange(from, to, this.changes.content)
  }

  comparePoint(from: number, to: number, byA: Decoration, byB: Decoration | null) {
    addRange(from, to, this.changes.content)
    if (from > to || byA.heightRelevant || byB && byB.heightRelevant)
      addRange(from, to, this.changes.height)
  }
}

export function findChangedRanges(a: DecorationSet, b: DecorationSet, diff: ReadonlyArray<ChangedRange>, lengthA: number): Changes {
  let comp = new DecorationComparator()
  a.compare(b, diff, comp, lengthA)
  return comp.changes
}

class HeightDecoScanner implements RangeIterator<Decoration> {
  ranges: number[] = []

  span() {}
  point(from: number, to: number, value: PointDecoration) { addRange(from, to, this.ranges) }
  ignore(from: number, to: number, value: Decoration) { return from == to && !value.heightRelevant }
}

export function heightRelevantDecorations(decorations: ReadonlyArray<DecorationSet>, ranges: ReadonlyArray<ChangedRange>): number[] {
  let scanner = new HeightDecoScanner
  for (let {fromB, toB} of ranges)
    RangeSet.iterateSpans(decorations, fromB, toB, scanner)
  return scanner.ranges
}
