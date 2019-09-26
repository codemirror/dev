import {combineConfig, fillConfig, Slot} from "../../extension/src/extension"
import {EditorView, ViewPlugin, ViewPluginValue, ViewUpdate, BlockType, BlockInfo} from "../../view/src"
import {Range, RangeValue, RangeSet} from "../../rangeset/src/rangeset"
import {ChangeSet, MapMode} from "../../state/src"
import {StyleModule} from "style-mod"

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

/// Configuration options when creating a generic gutter.
export interface GutterConfig {
  /// The CSS class for the gutter's wrapping DOM element.
  class: string
  /// Whether the gutter stays fixed during horizontal scrolling, or
  /// scrolls along with the content. Defaults to true.
  fixed?: boolean
  /// Controls whether empty gutter elements should be rendered.
  /// Defaults to false.
  renderEmptyElements?: boolean
  /// CSS classes to add to gutter elements (in addition to
  /// `codemirror-gutter-element`).
  elementClass?: string
  /// A function that computes the initial set of markers for the
  /// gutter, if any. Defaults to the empty set.
  initialMarkers?: (view: EditorView) => RangeSet<GutterMarker>
  /// A function that updates the set of markers when the view
  /// updates. This is where you could read transaction information to
  /// add or remove markers, depending on the kind of gutter you are
  /// implementing.
  updateMarkers?: (markers: RangeSet<GutterMarker>, update: ViewUpdate) => RangeSet<GutterMarker>
  /// Can be used to optionally add a single marker to every line.
  lineMarker?: (view: EditorView, line: BlockInfo, markers: ReadonlyArray<GutterMarker>) => GutterMarker | null
  /// @internal
  initialSpacer?: null | ((view: EditorView) => GutterMarker)
  /// @internal
  updateSpacer?: null | ((spacer: GutterMarker, update: ViewUpdate) => GutterMarker)
}

const defaults = {
  fixed: true,
  renderEmptyElements: false,
  elementClass: "",
  initialMarkers: () => RangeSet.empty,
  updateMarkers: (markers: RangeSet<GutterMarker>) => markers,
  lineMarker: () => null,
  initialSpacer: null,
  updateSpacer: null
}

/// Create a gutter extension.
export function gutter<T>(config: GutterConfig) {
  let conf = fillConfig(config, defaults)
  // FIXME allow client code to preserve a gutter config
  let plugin = new ViewPlugin(view => new GutterView(view, conf))
  return [plugin.extension, EditorView.styleModule(styles)]
}

class GutterView implements ViewPluginValue {
  dom: HTMLElement
  elements: GutterElement[] = []
  markers: RangeSet<GutterMarker>
  spacer: GutterElement | null = null

  constructor(public view: EditorView, public config: Required<GutterConfig>) {
    this.dom = document.createElement("div")
    this.dom.className = "codemirror-gutter " + config.class + " " + styles.gutter
    this.dom.setAttribute("aria-hidden", "true")
    if (config.fixed) {
      // FIXME IE11 fallback, which doesn't support position: sticky,
      // by using position: relative + event handlers that realign the
      // gutter (or just force fixed=false on IE11?)
      this.dom.style.position = "sticky"
    }
    view.dom.insertBefore(this.dom, view.contentDOM)
    this.markers = config.initialMarkers(view)
    if (config.initialSpacer) {
      this.spacer = new GutterElement(0, 0, [config.initialSpacer(view)], this.config.elementClass)
      this.dom.appendChild(this.spacer.dom)
      this.spacer.dom.style.cssText += "visibility: hidden; pointer-events: none"
    }
  }

  update(update: ViewUpdate) {
    this.markers = this.config.updateMarkers(this.markers.map(update.changes), update)
    if (this.spacer && this.config.updateSpacer) {
      let updated = this.config.updateSpacer(this.spacer.markers[0], update)
      if (updated != this.spacer.markers[0]) this.spacer.update(0, 0, [updated], this.config.elementClass)
    }
  }

  draw() {
    // FIXME would be nice to be able to recognize updates that didn't redraw
    let i = 0, height = 0
    let markers = this.markers.iter(this.view.viewport.from, this.view.viewport.to)
    let localMarkers: any[] = [], nextMarker = markers.next()
    this.view.viewportLines(line => {
      let text: BlockInfo | undefined
      if (Array.isArray(line.type)) text = line.type.find(b => b.type == BlockType.Text)
      else text = line.type == BlockType.Text ? line : undefined
      if (!text) return

      while (nextMarker && nextMarker.from <= text.from) {
        if (nextMarker.from == text.from) localMarkers.push(nextMarker.value)
        nextMarker = markers.next()
      }
      let forLine = this.config.lineMarker(this.view, text, localMarkers)
      if (forLine) localMarkers.unshift(forLine)
      if (localMarkers.length || this.config.renderEmptyElements) {
        let above = text.top - height
        if (i == this.elements.length) {
          let newElt = new GutterElement(text.height, above, localMarkers, this.config.elementClass)
          this.elements.push(newElt)
          this.dom.appendChild(newElt.dom)
        } else {
          let markers: ReadonlyArray<GutterMarker> = localMarkers, elt = this.elements[i]
          if (sameMarkers(markers, elt.markers)) {
            markers = elt.markers
            localMarkers.length = 0
          }
          elt.update(text.height, above, markers, this.config.elementClass)
        }
        height = text.bottom
        i++
        if (localMarkers.length) localMarkers = []
      }
    }, 0)
    while (this.elements.length > i) this.dom.removeChild(this.elements.pop()!.dom)
    this.dom.style.minHeight = this.view.contentHeight + "px"
  }

  destroy() {
    this.dom.remove()
  }

  get styles() { return styles }
}

class GutterElement {
  dom: HTMLElement
  height: number = -1
  above: number = 0
  markers!: ReadonlyArray<GutterMarker>

  constructor(height: number, above: number, markers: ReadonlyArray<GutterMarker>, eltClass: string) {
    this.dom = document.createElement("div")
    this.update(height, above, markers, eltClass)
  }

  update(height: number, above: number, markers: ReadonlyArray<GutterMarker>, eltClass: string) {
    if (this.height != height)
      this.dom.style.height = (this.height = height) + "px"
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
    if (this.markers != markers) {
      this.markers = markers
      for (let ch; ch = this.dom.lastChild;) ch.remove()
      let cls = "codemirror-gutter-element " + styles.gutterElement
      if (eltClass) cls += " " + eltClass
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

function sameMarkers<T>(a: ReadonlyArray<GutterMarker>, b: ReadonlyArray<GutterMarker>): boolean {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].compare(b[i])) return false
  return true
}

/// Configuration options when [creating](#gutter.lineNumbers) a line
/// number gutter.
export interface LineNumberConfig {
  /// See [`GutterConfig`](#gutter.GutterConfig.fixed).
  fixed?: boolean,
  /// How to display line numbers. Defaults to simply converting them
  /// to string.
  formatNumber?: (lineNo: number) => string
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
  let config = combineConfig(configs, {
    fixed: true,
    formatNumber: String
  })
  class NumberMarker extends GutterMarker {
    constructor(readonly number: number) { super() }

    eq(other: NumberMarker) { return this.number == other.number }

    toDOM() {
      return document.createTextNode(config.formatNumber(this.number))
    }
  }
  return gutter({
    class: "codemirror-line-numbers " + styles.lineNumberGutter,
    fixed: config.fixed,
    elementClass: styles.lineNumberGutterElement,
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
  })
}, {})

function maxLineNumber(lines: number) {
  let last = 9
  while (last < lines) last = last * 10 + 9
  return last
}

const styles = new StyleModule({
  gutter: {
    display: "flex !important", // Necessary -- prevents margin collapsing
    flexDirection: "column",
    flexShrink: 0,
    left: 0,
    boxSizing: "border-box",
    height: "100%",
    overflow: "hidden"
  },

  gutterElement: {
    boxSizing: "border-box"
  },

  lineNumberGutter: {
    background: "#f5f5f5",
    borderRight: "1px solid silver"
  },

  lineNumberGutterElement: {
    padding: "0 3px 0 5px",
    minWidth: "20px",
    textAlign: "right",
    color: "#999",
    whiteSpace: "nowrap"
  }
})
