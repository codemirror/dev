import {ChangeSet, ChangedRange, MapMode} from "../../state/src"
import {RangeValue, Range, RangeSet, RangeComparator, RangeIterator} from "../../rangeset/src/rangeset"
import {WidgetView} from "./inlineview"
import {attrsEq} from "./attributes"

/// Options passed when [creating](#view.Decoration^mark) a mark
/// decoration.
export interface MarkDecorationSpec {
  /// Whether the mark covers its start and end position or not. This
  /// influences whether content inserted at those positions becomes
  /// part of the mark. Defaults to false.
  inclusive?: boolean
  /// Specify whether the start position of the marked range should be
  /// inclusive.
  inclusiveStart?: boolean
  /// Whether the end should be inclusive.
  inclusiveEnd?: boolean
  /// Add attributes to the DOM elements that hold the text in the
  /// marked range.
  attributes?: {[key: string]: string}
  /// Shorthand for `{attributes: {class: value}}`.
  class?: string
  /// Add a wrapping element around the text in the marked range. Note
  /// that there will not be a single element covering the entire
  /// range—content is split on mark starts and ends, and each piece
  /// gets its own element.
  tagName?: string
}

/// Options passed when [creating](#view.Decoration^widget) a widget
/// decoration.
export interface WidgetDecorationSpec {
  /// The type of widget to draw here.
  widget: WidgetType
  /// Which side of the given position the widget is on. When this is
  /// positive, the widget will be drawn after the cursor if the
  /// cursor is on the same position. Otherwise, it'll be drawn before
  /// it. When multiple widgets sit at the same position, their `side`
  /// values will determine their ordering—those with a lower value
  /// come first. Defaults to 0.
  side?: number
  /// Determines whether this is a block widgets, which will be drawn
  /// between lines, or an inline widget (the default) which is drawn
  /// between the surrounding text.
  block?: boolean
}

/// Options passed when [creating](#view.Decoration^replace) a
/// replacing decoration.
export interface ReplaceDecorationSpec {
  /// An optional widget to drawn in the place of the replaced
  /// content.
  widget?: WidgetType
  /// Whether this range covers the positions on its sides. This
  /// influences whether new content becomes part of the range and
  /// whether the cursor can be drawn on its sides. Defaults to false.
  inclusive?: boolean
  /// Set inclusivity at the start.
  inclusiveStart?: boolean
  /// Set inclusivity at the end.
  inclusiveEnd?: boolean
  /// Whether this is a block-level decoration. Defaults to false.
  block?: boolean
}

/// Options passed when [creating](#view.Decoration^line) a line
/// decoration.
export interface LineDecorationSpec {
  /// DOM attributes to add to the element wrapping the line.
  attributes?: {[key: string]: string}
}

/// Widgets added to the content are described by subclasses of this
/// class. This makes it possible to delay creating of the DOM
/// structure for a widget until it is needed, and to avoid redrawing
/// widgets even when the decorations that define them are recreated.
/// `T` can be a type of value passed to instances of the widget type.
export abstract class WidgetType<T = any> {
  /// Create an instance of this widget type.
  constructor(
    /// @internal
    readonly value: T
  ) {}
  /// Build the DOM structure for this widget instance.
  abstract toDOM(): HTMLElement
  /// Compare this instance to another instance of the same class. By
  /// default, it'll compare the instances' parameters with `===`.
  eq(value: T): boolean { return this.value === value }
  /// Update a DOM element created by a widget of the same type but
  /// with a different value to reflect this widget. May return true
  /// to indicate that it could update, false to indicate it couldn't
  /// (in which case the widget will be redrawn). The default
  /// implementation just returns false.
  updateDOM(dom: HTMLElement): boolean { return false }

  /// @internal
  compare(other: WidgetType): boolean {
    return this == other || this.constructor == other.constructor && this.eq(other.value)
  }

  /// The estimated height this widget will have, to be used when
  /// estimating the height of content that hasn't been drawn. May
  /// return -1 to indicate you don't know. The default implementation
  /// returns -1.
  get estimatedHeight(): number { return -1 }

  /// Can be used to configure which kinds of events inside the widget
  /// should be ignored by the editor. The default is to ignore all
  /// events.
  ignoreEvent(event: Event): boolean { return true }

  //// @internal
  get customView(): null | typeof WidgetView { return null }
}

/// A decoration set represents a collection of decorated ranges,
/// organized for efficient access and mapping. See
/// [`RangeSet`](#rangeset.RangeSet) for its methods.
export type DecorationSet = RangeSet<Decoration>

/// A decorated range (or point).
export type DecoratedRange = Range<Decoration>

const INLINE_BIG_SIDE = 1e8, BLOCK_BIG_SIDE = 2e8

/// The different types of blocks that can occur in an editor view.
export enum BlockType {
  /// A line of text.
  Text,
  /// A block widget associated with the position after it.
  WidgetBefore,
  /// A block widget associated with the position before it.
  WidgetAfter,
  /// A block widget [replacing](#view.Decoration^replace) a range of content.
  WidgetRange
}

/// A decoration provides information on how to draw or style a piece
/// of content. You'll usually use it wrapped in a
/// [`DecoratedRange`](#view.DecoratedRange), which adds a start and
/// end position.
export abstract class Decoration extends RangeValue {
  /// @internal
  constructor(
    /// @internal
    readonly startSide: number,
    /// @internal
    readonly endSide: number,
    /// @internal
    readonly widget: WidgetType | null,
    /// The config object used to create this decoration.
    readonly spec: any) { super() }

  /// @internal
  get point() { return false }

  /// @internal
  get heightRelevant() { return false }

  /// Map this decoration through the given mapping.
  abstract map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null
  /// Compare this decoration to another one.
  abstract eq(other: Decoration): boolean

  /// Create a mark decoration, which influences the styling of the
  /// text in its range.
  static mark(from: number, to: number, spec: MarkDecorationSpec): DecoratedRange {
    if (from >= to) throw new RangeError("Mark decorations may not be empty")
    return new Range(from, to, new MarkDecoration(spec))
  }

  /// Create a widget decoration, which adds an element at the given
  /// position.
  static widget(pos: number, spec: WidgetDecorationSpec): DecoratedRange {
    let side = spec.side || 0
    if (spec.block) side += (BLOCK_BIG_SIDE + 1) * (side > 0 ? 1 : -1)
    return new Range(pos, pos, new PointDecoration(spec, side, side, !!spec.block, spec.widget))
  }

  /// Create a replace decoration which replaces the given range with
  /// a widget, or simply hides it.
  static replace(from: number, to: number, spec: ReplaceDecorationSpec): DecoratedRange {
    let block = !!spec.block
    let {start, end} = getInclusive(spec)
    let startSide = block ? -BLOCK_BIG_SIDE * (start ? 2 : 1) : INLINE_BIG_SIDE * (start ? -1 : 1)
    let endSide = block ? BLOCK_BIG_SIDE * (end ? 2 : 1) : INLINE_BIG_SIDE * (end ? 1 : -1)
    if (from > to || (from == to && startSide > 0 && endSide < 0))
      throw new RangeError("Invalid range for replacement decoration")
    return new Range(from, Math.max(from, to), new PointDecoration(spec, startSide, endSide, block, spec.widget || null))
  }

  /// Create a line decoration, which can add attributes to the line
  /// starting at the given position.
  static line(start: number, spec: LineDecorationSpec): DecoratedRange {
    return new Range(start, start, new LineDecoration(spec))
  }

  /// Build a [`DecorationSet`](#view.DecorationSet) from the given
  /// decorated range or ranges.
  static set(of: DecoratedRange | ReadonlyArray<DecoratedRange>): DecorationSet {
    return RangeSet.of<Decoration>(of)
  }

  /// The empty set of decorations.
  static none = RangeSet.empty as DecorationSet

  /// @internal
  hasHeight() { return this.widget ? this.widget.estimatedHeight > -1 : false }

  /// @internal
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
    return this.startSide < this.endSide ? BlockType.WidgetRange : this.startSide < 0 ? BlockType.WidgetBefore : BlockType.WidgetAfter
  }

  get heightRelevant() { return this.block || !!this.widget && this.widget.estimatedHeight >= 5 }

  map(mapping: ChangeSet, from: number, to: number): DecoratedRange | null {
    // FIXME make mapping behavior configurable?
    if (this.block) {
      let {type} = this
      let newFrom = type == BlockType.WidgetAfter ? mapping.mapPos(from, 1, MapMode.TrackAfter) : mapping.mapPos(from, -1, MapMode.TrackBefore)
      let newTo = type == BlockType.WidgetRange ? mapping.mapPos(to, 1, MapMode.TrackAfter) : newFrom
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

function widgetsEq(a: WidgetType | null, b: WidgetType | null): boolean {
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
