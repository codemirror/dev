import {MapMode} from "@codemirror/next/state"
import {RangeValue, Range, RangeSet} from "@codemirror/next/rangeset"
import {WidgetView} from "./inlineview"
import {attrsEq} from "./attributes"
import {EditorView} from "./editorview"

interface MarkDecorationSpec {
  /// Whether the mark covers its start and end position or not. This
  /// influences whether content inserted at those positions becomes
  /// part of the mark. Defaults to false.
  inclusive?: boolean
  /// Specify whether the start position of the marked range should be
  /// inclusive. Overrides `inclusive`, when both are present.
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
  /// Decoration specs allow other properties, which can be retrieved
  /// through the decoration's [`spec`](#view.Decoration.spec)
  /// property.
  [other: string]: any
}

interface WidgetDecorationSpec {
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
  /// Other properties are allowed.
  [other: string]: any
}

interface ReplaceDecorationSpec {
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
  /// Other properties are allowed.
  [other: string]: any
}

interface LineDecorationSpec {
  /// DOM attributes to add to the element wrapping the line.
  attributes?: {[key: string]: string}
  /// Other properties are allowed.
  [other: string]: any
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
  abstract toDOM(view: EditorView): HTMLElement
  /// Compare this instance to another instance of the same class. By
  /// default, it'll compare the instances' parameters with `===`.
  eq(value: T): boolean { return this.value === value }
  /// Update a DOM element created by a widget of the same type but
  /// with a different value to reflect this widget. May return true
  /// to indicate that it could update, false to indicate it couldn't
  /// (in which case the widget will be redrawn). The default
  /// implementation just returns false.
  updateDOM(_dom: HTMLElement): boolean { return false }

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
  ignoreEvent(_event: Event): boolean { return true }

  //// @internal
  get customView(): null | typeof WidgetView { return null }
}

/// A decoration set represents a collection of decorated ranges,
/// organized for efficient access and mapping. See
/// [`RangeSet`](#rangeset.RangeSet) for its methods.
export type DecorationSet = RangeSet<Decoration>

const enum Side { BigInline = 1e8, BigBlock = 2e8 }

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
/// [`Range`](#rangeset.Range), which adds a start and
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
  point!: boolean

  /// @internal
  get heightRelevant() { return false }

  abstract eq(other: Decoration): boolean

  /// Create a mark decoration, which influences the styling of the
  /// text in its range.
  static mark(spec: MarkDecorationSpec): Decoration {
    return new MarkDecoration(spec)
  }

  /// Create a widget decoration, which adds an element at the given
  /// position.
  static widget(spec: WidgetDecorationSpec): Decoration {
    let side = spec.side || 0
    if (spec.block) side += (Side.BigBlock + 1) * (side > 0 ? 1 : -1)
    return new PointDecoration(spec, side, side, !!spec.block, spec.widget || null, false)
  }

  /// Create a replace decoration which replaces the given range with
  /// a widget, or simply hides it.
  static replace(spec: ReplaceDecorationSpec): Decoration {
    let block = !!spec.block
    let {start, end} = getInclusive(spec)
    let startSide = block ? -Side.BigBlock * (start ? 2 : 1) : Side.BigInline * (start ? -1 : 1)
    let endSide = block ? Side.BigBlock * (end ? 2 : 1) : Side.BigInline * (end ? 1 : -1)
    return new PointDecoration(spec, startSide, endSide, block, spec.widget || null, true)
  }

  /// Create a line decoration, which can add DOM attributes to the
  /// line starting at the given position.
  static line(spec: LineDecorationSpec): Decoration {
    return new LineDecoration(spec)
  }

  /// Build a [`DecorationSet`](#view.DecorationSet) from the given
  /// decorated range or ranges.
  static set(of: Range<Decoration> | readonly Range<Decoration>[], sort = false): DecorationSet {
    return RangeSet.of<Decoration>(of, sort)
  }

  /// The empty set of decorations.
  static none = RangeSet.empty as DecorationSet

  /// @internal
  hasHeight() { return this.widget ? this.widget.estimatedHeight > -1 : false }
}

Decoration.prototype.point = false

export class MarkDecoration extends Decoration {
  constructor(spec: MarkDecorationSpec) {
    let {start, end} = getInclusive(spec)
    super(Side.BigInline * (start ? -1 : 1),
          Side.BigInline * (end ? 1 : -1),
          null, spec)
  }

  eq(other: Decoration): boolean {
    return this == other ||
      other instanceof MarkDecoration &&
      this.spec.tagName == other.spec.tagName &&
      this.spec.class == other.spec.class &&
      attrsEq(this.spec.attributes || null, other.spec.attributes || null)
  }

  range(from: number, to = from) {
    if (from >= to) throw new RangeError("Mark decorations may not be empty")
    return super.range(from, to)
  }
}

export class LineDecoration extends Decoration {
  constructor(spec: LineDecorationSpec) {
    super(-Side.BigInline, -Side.BigInline, null, spec)
  }

  eq(other: Decoration): boolean {
    return other instanceof LineDecoration && attrsEq(this.spec.attributes, other.spec.attributes)
  }

  range(from: number, to = from) {
    if (to != from) throw new RangeError("Line decoration ranges must be zero-length")
    return super.range(from, to)
  }
}

LineDecoration.prototype.mapMode = MapMode.TrackBefore
LineDecoration.prototype.point = true

export class PointDecoration extends Decoration {
  constructor(spec: any,
              startSide: number, endSide: number,
              public block: boolean,
              widget: WidgetType | null,
              readonly isReplace: boolean) {
    super(startSide, endSide, widget, spec)
    this.mapMode = !block ? MapMode.TrackDel : startSide < 0 ? MapMode.TrackBefore : MapMode.TrackAfter
  }

  // Only relevant when this.block == true
  get type() {
    return this.startSide < this.endSide ? BlockType.WidgetRange
      : this.startSide < 0 ? BlockType.WidgetBefore : BlockType.WidgetAfter
  }

  get heightRelevant() { return this.block || !!this.widget && this.widget.estimatedHeight >= 5 }

  eq(other: Decoration): boolean {
    return other instanceof PointDecoration &&
      widgetsEq(this.widget, other.widget) &&
      this.block == other.block &&
      this.startSide == other.startSide && this.endSide == other.endSide
  }

  range(from: number, to = from) {
    if (this.isReplace && (from > to || (from == to && this.startSide > 0 && this.endSide < 0)))
      throw new RangeError("Invalid range for replacement decoration")
    if (!this.isReplace && to != from)
      throw new RangeError("Widget decorations can only have zero-length ranges")
    return super.range(from, to)
  }
}

PointDecoration.prototype.point = true

function getInclusive(spec: {inclusive?: boolean, inclusiveStart?: boolean, inclusiveEnd?: boolean}): {start: boolean, end: boolean} {
  let {inclusiveStart: start, inclusiveEnd: end} = spec
  if (start == null) start = spec.inclusive
  if (end == null) end = spec.inclusive
  return {start: start || false, end: end || false}
}

function widgetsEq(a: WidgetType | null, b: WidgetType | null): boolean {
  return a == b || !!(a && b && a.compare(b))
}

const MinRangeGap = 4

export function addRange(from: number, to: number, ranges: number[]) {
  let last = ranges.length - 1
  if (last >= 0 && ranges[last] + MinRangeGap > from) ranges[last] = Math.max(ranges[last], to)
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
