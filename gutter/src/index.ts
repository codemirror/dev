import {EditorView, ViewPlugin, PluginField, ViewUpdate, BlockType, BlockInfo, themeClass} from "@codemirror/next/view"
import {Range, RangeValue, RangeSet, RangeCursor} from "@codemirror/next/rangeset"
import {combineConfig, fillConfig, MapMode, Facet, Extension, EditorState} from "@codemirror/next/state"

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

  /// Render the DOM node for this marker, if any.
  toDOM(_view: EditorView): Node | null { return null }

  /// Create a range that places this marker at the given position.
  at(pos: number) { return new Range(pos, pos, this) }

  /// This property can be used to add CSS classes to the gutter
  /// element that contains this marker.
  elementClass!: string
}

GutterMarker.prototype.elementClass = ""
GutterMarker.prototype.startMapMode = GutterMarker.prototype.endMapMode = MapMode.TrackBefore

type Handlers = {[event: string]: (view: EditorView, line: BlockInfo, event: any) => boolean}

/// Configuration options when creating a generic gutter.
export interface GutterConfig {
  /// The theme selector for the gutter's wrapping DOM element. Will
  /// be prefixed with `"gutter."` for the gutter wrapper, and then
  /// suffixed with `"Element"` for the individual line elements.
  style?: string
  /// Controls whether empty gutter elements should be rendered.
  /// Defaults to false.
  renderEmptyElements?: boolean
  /// Retrieve a set of markers to use in this gutter from the
  /// current editor state.
  markers?: (state: EditorState) => (RangeSet<GutterMarker> | readonly RangeSet<GutterMarker>[])
  /// Can be used to optionally add a single marker to every line.
  lineMarker?: (view: EditorView, line: BlockInfo, markers: readonly GutterMarker[]) => GutterMarker | null
  /// Use a spacer element that gives the gutter its base width.
  initialSpacer?: null | ((view: EditorView) => GutterMarker)
  /// Update the spacer element when the view is updated.
  updateSpacer?: null | ((spacer: GutterMarker, update: ViewUpdate) => GutterMarker)
  /// Supply event handlers for DOM events on this gutter.
  domEventHandlers?: Handlers
}

const defaults = {
  style: "",
  renderEmptyElements: false,
  elementStyle: "",
  markers: () => RangeSet.empty,
  lineMarker: () => null,
  initialSpacer: null,
  updateSpacer: null,
  domEventHandlers: {}
}

const activeGutters = Facet.define<Required<GutterConfig>>()

/// Define an editor gutter.
export function gutter(config: GutterConfig): Extension {
  return [gutters(), activeGutters.of(fillConfig(config, defaults))]
}

const baseTheme = EditorView.baseTheme({
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
})

const unfixGutters = Facet.define<boolean, boolean>({
  combine: values => values.some(x => x)
})

/// The gutter-drawing plugin is automatically enabled when you add a
/// gutter, but you can use this function to explicitly configure it.
///
/// Unless `fixed` is explicitly set to `false`, the gutters are
/// fixed, meaning they don't scroll along with the content
/// horizontally.
export function gutters(config?: {fixed?: boolean}): Extension {
  let result = [
    gutterView,
    baseTheme
  ]
  if (config && config.fixed === false) result.push(unfixGutters.of(true))
  return result
}

const gutterView = ViewPlugin.fromClass(class {
  gutters: SingleGutterView[]
  dom: HTMLElement
  fixed: boolean

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div")
    this.dom.className = themeClass("gutters")
    this.dom.setAttribute("aria-hidden", "true")
    this.gutters = view.state.facet(activeGutters).map(conf => new SingleGutterView(view, conf))
    for (let gutter of this.gutters) this.dom.appendChild(gutter.dom)
    this.fixed = !view.state.facet(unfixGutters)
    if (this.fixed) {
      // FIXME IE11 fallback, which doesn't support position: sticky,
      // by using position: relative + event handlers that realign the
      // gutter (or just force fixed=false on IE11?)
      this.dom.style.position = "sticky"
    }
    view.scrollDOM.insertBefore(this.dom, view.contentDOM)
  }

  update(update: ViewUpdate) {
    if (!this.updateGutters(update)) return
    let contexts = this.gutters.map(gutter => new UpdateContext(gutter, this.view.viewport))
    this.view.viewportLines(line => {
      let text: BlockInfo | undefined
      if (Array.isArray(line.type)) text = line.type.find(b => b.type == BlockType.Text)
      else text = line.type == BlockType.Text ? line : undefined
      if (!text) return

      for (let cx of contexts) cx.line(this.view, text)
    }, 0)
    for (let cx of contexts) cx.finish()
    this.dom.style.minHeight = this.view.contentHeight + "px"
    if (update.state.facet(unfixGutters) != !this.fixed) {
      this.fixed = !this.fixed
      this.dom.style.position = this.fixed ? "sticky" : ""
    }
  }

  updateGutters(update: ViewUpdate) {
    let prev = update.prevState.facet(activeGutters), cur = update.state.facet(activeGutters)
    let change = update.docChanged || update.heightChanged
    if (prev == cur) {
      for (let gutter of this.gutters) if (gutter.update(update)) change = true
    } else {
      change = true
      let gutters = []
      for (let conf of cur) {
        let known = prev.indexOf(conf)
        if (known < 0) {
          gutters.push(new SingleGutterView(this.view, conf))
        } else {
          this.gutters[known].update(update)
          gutters.push(this.gutters[known])
        }
      }
      for (let g of this.gutters) g.dom.remove()
      for (let g of gutters) this.dom.appendChild(g.dom)
      this.gutters = gutters
    }
    return change
  }
}).provide(PluginField.scrollMargins, value => {
  if (value.gutters.length == 0 || !value.fixed) return null
  return value.view.textDirection == "ltr" ? {left: value.dom.offsetWidth} : {right: value.dom.offsetWidth}
})

class UpdateContext {
  cursor: RangeCursor<GutterMarker>
  localMarkers: GutterMarker[] = []
  i = 0
  height = 0

  constructor(readonly gutter: SingleGutterView, viewport: {from: number, to: number}) {
    this.cursor = RangeSet.iter(Array.isArray(gutter.markers) ? gutter.markers : [gutter.markers], viewport.from)
  }

  line(view: EditorView, line: BlockInfo) {
    if (this.localMarkers.length) this.localMarkers = []
    while (this.cursor.value && this.cursor.from <= line.from) {
      if (this.cursor.from == line.from) this.localMarkers.push(this.cursor.value)
      this.cursor.next()
    }
    let forLine = this.gutter.config.lineMarker(view, line, this.localMarkers)
    if (forLine) this.localMarkers.unshift(forLine)

    let gutter = this.gutter
    if (this.localMarkers.length == 0 && !gutter.config.renderEmptyElements) return

    let above = line.top - this.height
    if (this.i == gutter.elements.length) {
      let newElt = new GutterElement(view, line.height, above, this.localMarkers, gutter.elementClass)
      gutter.elements.push(newElt)
      gutter.dom.appendChild(newElt.dom)
    } else {
      let markers: readonly GutterMarker[] = this.localMarkers, elt = gutter.elements[this.i]
      if (sameMarkers(markers, elt.markers)) {
        markers = elt.markers
        this.localMarkers.length = 0
      }
      elt.update(view, line.height, above, markers, gutter.elementClass)
    }
    this.height = line.bottom
    this.i++
  }

  finish() {
    let gutter = this.gutter
    while (gutter.elements.length > this.i) gutter.dom.removeChild(gutter.elements.pop()!.dom)
  }
}

class SingleGutterView {
  dom: HTMLElement
  elements: GutterElement[] = []
  markers: RangeSet<GutterMarker> | readonly RangeSet<GutterMarker>[]
  spacer: GutterElement | null = null
  elementClass!: string

  constructor(public view: EditorView, public config: Required<GutterConfig>) {
    this.dom = document.createElement("div")
    this.dom.className = themeClass("gutter" + (this.config.style ? "." + this.config.style : ""))
    this.elementClass = themeClass("gutterElement" + (this.config.style ? "." + this.config.style : ""))
    for (let prop in config.domEventHandlers) {
      this.dom.addEventListener(prop, (event: Event) => {
        let line = view.lineAtHeight((event as MouseEvent).clientY)
        if (config.domEventHandlers[prop](view, line, event)) event.preventDefault()
      })
    }
    this.markers = config.markers(view.state)
    if (config.initialSpacer) {
      this.spacer = new GutterElement(view, 0, 0, [config.initialSpacer(view)], this.elementClass)
      this.dom.appendChild(this.spacer.dom)
      this.spacer.dom.style.cssText += "visibility: hidden; pointer-events: none"
    }
  }

  update(update: ViewUpdate) {
    let prevMarkers = this.markers
    this.markers = this.config.markers(update.state)
    if (this.spacer && this.config.updateSpacer) {
      let updated = this.config.updateSpacer(this.spacer.markers[0], update)
      if (updated != this.spacer.markers[0]) this.spacer.update(update.view, 0, 0, [updated], this.elementClass)
    }
    return this.markers == prevMarkers
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

  constructor(view: EditorView, height: number, above: number, markers: readonly GutterMarker[], eltClass: string) {
    this.dom = document.createElement("div")
    this.update(view, height, above, markers, eltClass)
  }

  update(view: EditorView, height: number, above: number, markers: readonly GutterMarker[], cssClass: string) {
    if (this.height != height)
      this.dom.style.height = (this.height = height) + "px"
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
    if (this.markers != markers) {
      this.markers = markers
      for (let ch; ch = this.dom.lastChild;) ch.remove()
      let cls = cssClass
      for (let m of markers) {
        let dom = m.toDOM(view)
        if (dom) this.dom.appendChild(dom)
        let c = m.elementClass
        if (c) cls += " " + c
      }
      this.dom.className = cls
    }
  }
}

function sameMarkers(a: readonly GutterMarker[], b: readonly GutterMarker[]): boolean {
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
  domEventHandlers?: Handlers
}

/// Facet used to provide markers to the line number gutter.
export const lineNumberMarkers = Facet.define<RangeSet<GutterMarker>>()

const lineNumberConfig = Facet.define<LineNumberConfig, Required<LineNumberConfig>>({
  combine(values) {
    return combineConfig<Required<LineNumberConfig>>(values, {formatNumber: String, domEventHandlers: {}}, {
      domEventHandlers(a: Handlers, b: Handlers) {
        let result: Handlers = {}
        for (let event in a) result[event] = a[event]
        for (let event in b) {
          let exists = result[event], add = b[event]
          result[event] = exists ? (view, line, event) => exists(view, line, event) || add(view, line, event) : add
        }
        return result
      }
    })
  }
})

class NumberMarker extends GutterMarker {
  constructor(readonly number: number) { super() }

  eq(other: NumberMarker) { return this.number == other.number }

  toDOM(view: EditorView) {
    let config = view.state.facet(lineNumberConfig)
    return document.createTextNode(config.formatNumber(this.number))
  }
}

const lineNumberGutter = gutter({
  style: "lineNumber",
  markers(state: EditorState) { return state.facet(lineNumberMarkers) },
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
})

/// Create a line number gutter extension. The order in which the
/// gutters appear is determined by their extension priority.
export function lineNumbers(config: LineNumberConfig = {}): Extension {
  return [
    lineNumberConfig.of(config),
    lineNumberGutter
  ]
}

function maxLineNumber(lines: number) {
  let last = 9
  while (last < lines) last = last * 10 + 9
  return last
}
