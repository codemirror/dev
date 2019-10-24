import {combineConfig, fillConfig, Slot, Extension} from "../../extension"
import {EditorView, ViewPlugin, ViewPluginValue, ViewUpdate, BlockType, BlockInfo} from "../../view"
import {Range, RangeValue, RangeSet} from "../../rangeset"
import {ChangeSet, MapMode} from "../../state"

/// A gutter marker represents a bit of information attached to a line
/// in a specific gutter. Your own custom markers have to extend this
/// class.
export abstract class GutterMarker extends RangeValue {
  /// @internal
  compare(other: GutterMarker) {
    return this == other || this.constructor == other.constructor && this.eq(other)
  }

  /// Compare this marker to another marker of the same type.
  abstract eq(other: GutterMarker): boolean

  /// Map this marker through a position mapping.
  map(mapping: ChangeSet, pos: number): Range<GutterMarker> | null {
    pos = mapping.mapPos(pos, -1, MapMode.TrackBefore)
    return pos < 0 ? null : new Range(pos, pos, this)
  }

  /// Render the DOM node for this marker, if any.
  toDOM(): Node | null { return null }

  /// Create a range that places this marker at the given position.
  at(pos: number) { return new Range(pos, pos, this) }

  /// This property can be used to add CSS classes to the gutter
  /// element that contains this marker.
  elementClass!: string
}

GutterMarker.prototype.elementClass = ""

type Handlers = {[event: string]: (view: EditorView, line: BlockInfo, event: any) => boolean}

/// Configuration options when creating a generic gutter.
export interface GutterConfig {
  /// The theme style for the gutter's wrapping DOM element (in
  /// addition to `gutter`). Will be suffixed with `"Element"` to get
  /// the theme style for the gutter elements.
  style?: string
  /// Controls whether empty gutter elements should be rendered.
  /// Defaults to false.
  renderEmptyElements?: boolean
  /// A function that computes the initial set of markers for the
  /// gutter, if any. Defaults to the empty set.
  initialMarkers?: (view: EditorView) => RangeSet<GutterMarker>
  /// A function that updates the set of markers when the view
  /// updates. This is where you could read transaction information to
  /// add or remove markers, depending on the kind of gutter you are
  /// implementing.
  updateMarkers?: (markers: RangeSet<GutterMarker>, update: ViewUpdate) => RangeSet<GutterMarker>
  /// Can be used to optionally add a single marker to every line.
  lineMarker?: (view: EditorView, line: BlockInfo, markers: readonly GutterMarker[]) => GutterMarker | null
  /// Use a spacer element that gives the gutter its base width.
  initialSpacer?: null | ((view: EditorView) => GutterMarker)
  /// Update the spacer element when the view is updated.
  updateSpacer?: null | ((spacer: GutterMarker, update: ViewUpdate) => GutterMarker)
  /// Supply event handlers for DOM events on this gutter.
  handleDOMEvents?: Handlers
}

const defaults = {
  style: "",
  renderEmptyElements: false,
  elementStyle: "",
  initialMarkers: () => RangeSet.empty,
  updateMarkers: (markers: RangeSet<GutterMarker>) => markers,
  lineMarker: () => null,
  initialSpacer: null,
  updateSpacer: null,
  handleDOMEvents: {}
}

const gutterBehavior = EditorView.extend.behavior<Gutter>()

export class Gutter {
  /// @internal
  config: Required<GutterConfig>

  constructor(config: GutterConfig) {
    this.config = fillConfig(config, defaults)
  }

  get extension() {
    return [
      gutters(),
      gutterBehavior(this)
    ]
  }
}

/// The gutter-drawing plugin is automatically enabled when you add a
/// gutter, but you can use this function to explicitly configure it.
///
/// Unless `fixed` is explicitly set to `false`, the gutters are
/// fixed, meaning they don't scroll along with the content
/// horizontally.
export const gutters = EditorView.extend.unique((config: {fixed?: boolean}[]): Extension => {
  let fixed = config.every(c => c.fixed !== false)
  return [
    ViewPlugin.create(view => new GutterView(view, {fixed})).extension,
    EditorView.theme(baseTheme)
  ]
}, {})

class GutterView implements ViewPluginValue {
  gutters: SingleGutterView[]
  dom: HTMLElement

  constructor(readonly view: EditorView, config: {fixed: boolean}) {
    this.dom = document.createElement("div")
    this.dom.setAttribute("aria-hidden", "true")
    this.gutters = view.behavior(gutterBehavior).map(gutter => new SingleGutterView(view, gutter.config))
    for (let gutter of this.gutters) this.dom.appendChild(gutter.dom)
    if (config.fixed) {
      // FIXME IE11 fallback, which doesn't support position: sticky,
      // by using position: relative + event handlers that realign the
      // gutter (or just force fixed=false on IE11?)
      this.dom.style.position = "sticky"
    }
    view.scrollDOM.insertBefore(this.dom, view.contentDOM)
    this.updateTheme()
  }

  updateTheme() {
    this.dom.className = this.view.cssClass("gutters")
    for (let gutter of this.gutters) gutter.updateTheme()
  }

  update(update: ViewUpdate) {
    if (update.themeChanged) this.updateTheme()
    for (let gutter of this.gutters) gutter.update(update)
  }

  draw() {
    // FIXME would be nice to be able to recognize updates that didn't redraw
    let contexts = this.gutters.map(gutter => new UpdateContext(gutter, this.view.viewport))
    this.view.viewportLines(line => {
      let text: BlockInfo | undefined
      if (Array.isArray(line.type)) text = line.type.find(b => b.type == BlockType.Text)
      else text = line.type == BlockType.Text ? line : undefined
      if (!text) return

      for (let cx of contexts) cx.line(this.view, text)
    }, 0)
    for (let cx of contexts) cx.finish(this.view)
    this.dom.style.minHeight = this.view.contentHeight + "px"
  }
}

class UpdateContext {
  next: () => (void | Range<GutterMarker>)
  localMarkers: GutterMarker[] = []
  nextMarker: void | Range<GutterMarker>
  i = 0
  height = 0

  constructor(readonly gutter: SingleGutterView, viewport: {from: number, to: number}) {
    this.next = gutter.markers.iter(viewport.from, viewport.to).next
    this.nextMarker = this.next()
  }

  line(view: EditorView, line: BlockInfo) {
    if (this.localMarkers.length) this.localMarkers = []
    while (this.nextMarker && this.nextMarker.from <= line.from) {
      if (this.nextMarker.from == line.from) this.localMarkers.push(this.nextMarker.value)
      this.nextMarker = this.next()
    }
    let forLine = this.gutter.config.lineMarker(view, line, this.localMarkers)
    if (forLine) this.localMarkers.unshift(forLine)

    let gutter = this.gutter
    if (this.localMarkers.length == 0 && !gutter.config.renderEmptyElements) return

    let above = line.top - this.height
    if (this.i == gutter.elements.length) {
      let newElt = new GutterElement(line.height, above, this.localMarkers, gutter.elementClass)
      gutter.elements.push(newElt)
      gutter.dom.appendChild(newElt.dom)
    } else {
      let markers: readonly GutterMarker[] = this.localMarkers, elt = gutter.elements[this.i]
      if (sameMarkers(markers, elt.markers)) {
        markers = elt.markers
        this.localMarkers.length = 0
      }
      elt.update(line.height, above, markers, gutter.elementClass)
    }
    this.height = line.bottom
    this.i++
  }

  finish(view: EditorView) {
    let gutter = this.gutter
    while (gutter.elements.length > this.i) gutter.dom.removeChild(gutter.elements.pop()!.dom)
  }
}

class SingleGutterView {
  dom: HTMLElement
  elements: GutterElement[] = []
  markers: RangeSet<GutterMarker>
  spacer: GutterElement | null = null
  elementClass!: string

  constructor(public view: EditorView, public config: Required<GutterConfig>) {
    this.dom = document.createElement("div")
    for (let prop in config.handleDOMEvents) {
      this.dom.addEventListener(prop, (event: Event) => {
        let line = view.lineAtHeight((event as MouseEvent).clientY)
        if (config.handleDOMEvents[prop](view, line, event)) event.preventDefault()
      })
    }
    this.markers = config.initialMarkers(view)
    if (config.initialSpacer) {
      this.spacer = new GutterElement(0, 0, [config.initialSpacer(view)], this.elementClass)
      this.dom.appendChild(this.spacer.dom)
      this.spacer.dom.style.cssText += "visibility: hidden; pointer-events: none"
    }
    this.updateTheme()
  }

  updateTheme() {
    this.dom.className = this.view.cssClass("gutter" + (this.config.style ? "." + this.config.style : ""))
    this.elementClass = this.view.cssClass("gutterElement" + (this.config.style ? "." + this.config.style : ""))
    while (this.elements.length) this.dom.removeChild(this.elements.pop()!.dom)
  }

  update(update: ViewUpdate) {
    if (update.themeChanged) this.updateTheme()
    this.markers = this.config.updateMarkers(this.markers.map(update.changes), update)
    if (this.spacer && this.config.updateSpacer) {
      let updated = this.config.updateSpacer(this.spacer.markers[0], update)
      if (updated != this.spacer.markers[0]) this.spacer.update(0, 0, [updated], this.elementClass)
    }
  }

  destroy() {
    this.dom.remove()
  }
}

class GutterElement {
  dom: HTMLElement
  height: number = -1
  above: number = 0
  markers!: readonly GutterMarker[]

  constructor(height: number, above: number, markers: readonly GutterMarker[], eltClass: string) {
    this.dom = document.createElement("div")
    this.update(height, above, markers, eltClass)
  }

  update(height: number, above: number, markers: readonly GutterMarker[], cssClass: string) {
    if (this.height != height)
      this.dom.style.height = (this.height = height) + "px"
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
    if (this.markers != markers) {
      this.markers = markers
      for (let ch; ch = this.dom.lastChild;) ch.remove()
      let cls = cssClass
      for (let m of markers) {
        let dom = m.toDOM()
        if (dom) this.dom.appendChild(dom)
        let c = m.elementClass
        if (c) cls += " " + c
      }
      this.dom.className = cls
    }
  }
}

function sameMarkers<T>(a: readonly GutterMarker[], b: readonly GutterMarker[]): boolean {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].compare(b[i])) return false
  return true
}

/// Configuration options when [creating](#gutter.lineNumbers) a line
/// number gutter.
export interface LineNumberConfig {
  /// How to display line numbers. Defaults to simply converting them
  /// to string.
  formatNumber?: (lineNo: number) => string
  /// Supply event handlers for DOM events on this gutter.
  handleDOMEvents?: Handlers
}

/// Used to insert markers into the line number gutter.
export const lineNumberMarkers = Slot.define<LineNumberMarkerUpdate>()

export type LineNumberMarkerUpdate = {
  /// When given, adds these markers.
  add?: Range<GutterMarker>[],
  /// Filter the line number markers through this function.
  filter?: (from: number, to: number, marker: GutterMarker) => boolean
}

/// Create a line number gutter extension. The order in which the
/// gutters appear is determined by their extension priority.
export const lineNumbers = EditorView.extend.unique<LineNumberConfig>(configs => {
  let config = combineConfig<Required<LineNumberConfig>>(configs, {formatNumber: String, handleDOMEvents: {}}, {
    handleDOMEvents(a: Handlers, b: Handlers) {
      let result: Handlers = {}
      for (let event in a) result[event] = a[event]
      for (let event in b) {
        let exists = result[event], add = b[event]
        result[event] = exists ? (view, line, event) => exists(view, line, event) || add(view, line, event) : add
      }
      return result
    }
  })
  class NumberMarker extends GutterMarker {
    constructor(readonly number: number) { super() }

    eq(other: NumberMarker) { return this.number == other.number }

    toDOM() {
      return document.createTextNode(config.formatNumber(this.number))
    }
  }
  // FIXME preserve markers across reconfigurations by somehow making
  // this gutter static
  return new Gutter({
    style: "lineNumber",
    updateMarkers(markers: RangeSet<GutterMarker>, update: ViewUpdate) {
      let slot = update.getMeta(lineNumberMarkers)
      if (slot) markers = markers.update(slot.add || [], slot.filter || null)
      return markers
    },
    lineMarker(view, line, others) {
      if (others.length) return null
      // FIXME try to make the line number queries cheaper?
      return new NumberMarker(view.state.doc.lineAt(line.from).number)
    },
    initialSpacer(view: EditorView) {
      return new NumberMarker(maxLineNumber(view.state.doc.lines))
    },
    updateSpacer(spacer: GutterMarker, update: ViewUpdate) {
      let max = maxLineNumber(update.view.state.doc.lines)
      return max == (spacer as NumberMarker).number ? spacer : new NumberMarker(max)
    }
  }).extension
}, {})

function maxLineNumber(lines: number) {
  let last = 9
  while (last < lines) last = last * 10 + 9
  return last
}

const baseTheme = {
  gutters: {
    background: "#f5f5f5",
    borderRight: "1px solid silver",
    color: "#999",
    display: "flex",
    height: "100%",
    boxSizing: "border-box",
    left: 0
  },

  gutter: {
    display: "flex !important", // Necessary -- prevents margin collapsing
    flexDirection: "column",
    flexShrink: 0,
    boxSizing: "border-box",
    height: "100%",
    overflow: "hidden"
  },

  gutterElement: {
    boxSizing: "border-box"
  },

  "gutterElement.lineNumber": {
    padding: "0 3px 0 5px",
    minWidth: "20px",
    textAlign: "right",
    whiteSpace: "nowrap"
  }
}
