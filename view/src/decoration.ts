import {ChangeSet, ChangedRange} from "../../state/src"
import {RangeValue, Range, RangeSet, RangeComparator, RangeIterator} from "../../rangeset/src/rangeset"
import {attrsEq} from "./attributes"

export interface RangeDecorationSpec {
  inclusiveStart?: boolean
  inclusiveEnd?: boolean
  attributes?: {[key: string]: string}
  // Shorthand for {attributes: {class: value}}
  class?: string
  tagName?: string
  collapsed?: boolean | WidgetType
}

export interface WidgetDecorationSpec {
  widget: WidgetType
  side?: number
}

export interface LineDecorationSpec {
  attributes?: {[key: string]: string}
}

export interface BlockWidgetDecorationSpec {
  widget: WidgetType,
  side?: number
}

export interface BlockRangeDecorationSpec {
  widget: WidgetType,
  priority?: number
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

export abstract class Decoration implements RangeValue {
  // @internal
  constructor(
    // @internal
    readonly startSide: number,
    // @internal
    readonly widget: WidgetType | null,
    readonly spec: any) {}

  get endSide() { return this.startSide }

  abstract map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null;

  // FIXME split into separate variants for collapsed and styled ranges?

  static range(from: number, to: number, spec: RangeDecorationSpec): DecoratedRange {
    if (from >= to) throw new RangeError("Range decorations may not be empty")
    return new Range(from, to, new RangeDecoration(spec))
  }

  static widget(pos: number, spec: WidgetDecorationSpec): DecoratedRange {
    return new Range(pos, pos, new WidgetDecoration(spec))
  }

  static line(pos: number, spec: LineDecorationSpec): DecoratedRange {
    return new Range(pos, pos, new LineDecoration(spec))
  }

  static blockWidget(pos: number, spec: BlockWidgetDecorationSpec): DecoratedRange {
    let sideSpec = spec.side || -1, side = sideSpec + BLOCK_BIG_SIDE * (sideSpec < 0 ? -1 : 1)
    return new Range(pos, pos, new BlockWidgetDecoration(spec.widget, side, side, spec))
  }

  static blockRange(from: number, to: number, spec: BlockRangeDecorationSpec): DecoratedRange {
    let side = BLOCK_BIG_SIDE + Math.max(0, spec.priority || 0)
    return new Range(from, to, new BlockWidgetDecoration(spec.widget, -side, side, spec))
  }

  static set(of: DecoratedRange | ReadonlyArray<DecoratedRange>): DecorationSet {
    return RangeSet.of<Decoration>(of)
  }

  static none = RangeSet.empty as DecorationSet

  // @internal
  abstract sameEffect(other: Decoration): boolean

  // @internal
  hasHeight() { return this.widget ? this.widget.estimatedHeight > -1 : false }
}

export class RangeDecoration extends Decoration {
  readonly collapsed: boolean

  constructor(readonly spec: RangeDecorationSpec) {
    super(INLINE_BIG_SIDE * (spec.inclusiveStart === true ? -1 : 1),
          spec.collapsed instanceof WidgetType ? spec.collapsed : null, spec)
    this.collapsed = !!spec.collapsed
    Object.defineProperty(this, "endSide", {value: INLINE_BIG_SIDE * (spec.inclusiveEnd === true ? 1 : -1)})
  }

  map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null {
    let newFrom = mapping.mapPos(from, this.startSide, true), newTo = mapping.mapPos(to, this.endSide, true)
    if (newFrom < 0) {
      if (newTo < 0) return null
      newFrom = this.startSide >= 0 ? -(newFrom + 1) : mapping.mapPos(from, 1)
    } else if (newTo < 0) {
      newTo = this.endSide < 0 ? -(newTo + 1) : mapping.mapPos(to, -1)
    }
    return newFrom < newTo ? new Range(newFrom, newTo, this) : null
  }

  sameEffect(other: RangeDecoration): boolean {
    return this == other ||
      this.spec.tagName == other.spec.tagName &&
      this.spec.class == other.spec.class &&
      this.collapsed == other.collapsed &&
      widgetsEq(this.widget, other.widget) &&
      attrsEq(this.spec.attributes || null, other.spec.attributes || null)
  }
}

export class WidgetDecoration extends Decoration {
  widget!: WidgetType

  constructor(readonly spec: WidgetDecorationSpec) {
    super(spec.side || 0, spec.widget || null, spec)
  }

  map(mapping: ChangeSet, pos: number): DecoratedRange | null {
    pos = mapping.mapPos(pos, this.startSide, true)
    return pos < 0 ? null : new Range(pos, pos, this)
  }

  sameEffect(other: Decoration): boolean {
    return other instanceof WidgetDecoration && widgetsEq(this.widget, other.widget) && this.startSide == other.startSide
  }
}

export class LineDecoration extends Decoration {
  constructor(spec: LineDecorationSpec) {
    super(-INLINE_BIG_SIDE, null, spec)
  }

  map(mapping: ChangeSet, pos: number): DecoratedRange | null {
    pos = mapStrict(pos, -1, mapping)
    return pos < 0 ? null : new Range(pos, pos, this)
  }

  sameEffect(other: Decoration): boolean {
    return other instanceof LineDecoration &&
      attrsEq(this.spec.attributes, other.spec.attributes)
  }
}

// Map `pos`, but return -1 when the character before or after
// (depending on `side`) is deleted.
function mapStrict(pos: number, side: number, mapping: ChangeSet): number {
  for (let change of mapping.changes) {
    // If the line break before was deleted, drop this decoration
    if (change.from <= pos + (side < 0 ? -1 : 0) && change.to >= pos + (side > 0 ? 1 : 0)) return -1
    if (change.from < pos) pos += change.length - (change.to - change.from)
  }
  return pos
}

export class BlockWidgetDecoration extends Decoration {
  constructor(widget: WidgetType, startSide: number, endSide: number, spec: any) {
    super(startSide, widget, spec)
    Object.defineProperty(this, "endSide", {value: endSide})
  }

  map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null {
    if (from == to) {
      from = mapStrict(from, this.startSide, mapping)
      return from < 0 ? null : new Range(from, from, this)
    } else {
      from = mapStrict(from, -1, mapping)
      to = mapStrict(to, 1, mapping)
      return from < 0 || to < 0 ? null : new Range(from, to, this)
    }
  }

  sameEffect(other: Decoration): boolean {
    return other instanceof BlockWidgetDecoration &&
      widgetsEq(this.widget, other.widget) &&
      this.startSide == other.startSide
  }

  get collapsed() { return this.startSide < this.endSide }

  hasHeight() { return true }
}

export function widgetsEq(a: WidgetType | null, b: WidgetType | null): boolean {
  return a == b || !!(a && b && a.compare(b))
}

function compareSets(setA: Decoration[], setB: Decoration[]): boolean {
  if (setA.length != setB.length) return false
  search: for (let value of setA) {
    for (let valueB of setB) if (value.sameEffect(valueB)) continue search
    return false
  }
  return true
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
    if (!compareSets(activeA, activeB))
      addRange(from, to, this.changes.content)
  }

  compareCollapsed(from: number, to: number, byA: Decoration, byB: Decoration) {
    if (!byA.sameEffect(byB)) {
      addRange(from, to, this.changes.content)
      addRange(from, to, this.changes.height)
    }
  }

  comparePoints(pos: number, pointsA: Decoration[], pointsB: Decoration[]) {
    if (!compareSets(pointsA, pointsB)) {
      addRange(pos, pos, this.changes.content)
      if (pointsA.some(d => d.hasHeight()) || pointsB.some(d => d.hasHeight()))
        addRange(pos, pos, this.changes.height)
    }
  }
}

export function findChangedRanges(a: DecorationSet, b: DecorationSet, diff: ReadonlyArray<ChangedRange>, lengthA: number): Changes {
  let comp = new DecorationComparator()
  a.compare(b, diff, comp, lengthA)
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

export function heightRelevantDecorations(decorations: ReadonlyArray<DecorationSet>, ranges: ReadonlyArray<ChangedRange>): number[] {
  let scanner = new HeightDecoScanner
  for (let {fromB, toB} of ranges) if (fromB < toB) {
    scanner.pos = fromB
    RangeSet.iterateSpans(decorations, fromB, toB, scanner)
  }
  return scanner.ranges
}
