import {combineConfig, fillConfig, Full, Slot} from "../../extension/src/extension"
import {EditorView, ViewExtension, ViewPlugin, ViewUpdate, styleModule, viewPlugin, BlockType, BlockInfo} from "../../view/src"
import {Range, RangeValue, RangeSet} from "../../rangeset/src/rangeset"
import {ChangeSet, MapMode} from "../../state/src"
import {StyleModule} from "style-mod"

export abstract class GutterMarker<T = any> extends RangeValue {
  constructor(readonly value: T) { super() }

  eq(other: GutterMarker<T>) {
    return this == other || this.constructor == other.constructor && this.value === other.value
  }

  map(mapping: ChangeSet, pos: number): Range<GutterMarker<T>> | null {
    pos = mapping.mapPos(pos, -1, MapMode.TrackBefore)
    return pos < 0 ? null : new Range(pos, pos, this)
  }

  toDOM(): Node | null { return null }

  elementClass!: string | null

  static create<T>(pos: number, value: T): Range<GutterMarker<T>> {
    return new Range(pos, pos, new (this as any)(value))
  }

  static set(of: Range<GutterMarker> | ReadonlyArray<Range<GutterMarker>>): GutterMarkerSet {
    return RangeSet.of<GutterMarker>(of)
  }
}

GutterMarker.prototype.elementClass = null

export type GutterMarkerSet = RangeSet<GutterMarker>

export interface GutterConfig {
  class: string
  fixed?: boolean
  renderEmptyElements?: boolean
  initialMarkers?: (view: EditorView) => GutterMarkerSet
  updateMarkers?: (markers: GutterMarkerSet, update: ViewUpdate) => GutterMarkerSet
  lineMarker?: (view: EditorView, line: BlockInfo, markers: ReadonlyArray<GutterMarker>) => GutterMarker | null
  // @internal
  initialSpacer?: null | ((view: EditorView) => GutterMarker)
  // @internal
  updateSpacer?: null | ((spacer: GutterMarker, update: ViewUpdate) => GutterMarker)
}

const defaults = {
  fixed: true,
  renderEmptyElements: false,
  initialMarkers: () => RangeSet.empty,
  updateMarkers: (markers: GutterMarkerSet) => markers,
  lineMarker: () => null,
  initialSpacer: null,
  updateSpacer: null
}

export function gutter<T>(config: GutterConfig) {
  let conf = fillConfig(config, defaults)
  return ViewExtension.all(
    viewPlugin(view => new GutterView(view, conf)),
    styleModule(styles)
  )
}

class GutterView implements ViewPlugin {
  dom: HTMLElement
  elements: GutterElement[] = []
  markers: GutterMarkerSet
  spacer: GutterElement | null = null

  constructor(public view: EditorView, public config: Full<GutterConfig>) {
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
      this.spacer = new GutterElement(0, 0, [config.initialSpacer(view)])
      this.dom.appendChild(this.spacer.dom)
      this.spacer.dom.style.cssText += "visibility: hidden; pointer-events: none"
    }
    this.updateGutter()
  }

  update(update: ViewUpdate) {
    this.markers = this.config.updateMarkers(this.markers.map(update.changes), update)
    if (this.spacer && this.config.updateSpacer) {
      let updated = this.config.updateSpacer(this.spacer.markers[0], update)
      if (updated != this.spacer.markers[0]) this.spacer.update(0, 0, [updated])
    }
    // FIXME would be nice to be able to recognize updates that didn't redraw
    this.updateGutter()
  }

  updateGutter() {
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
          let newElt = new GutterElement(text.height, above, localMarkers)
          this.elements.push(newElt)
          this.dom.appendChild(newElt.dom)
        } else {
          let markers: ReadonlyArray<GutterMarker> = localMarkers, elt = this.elements[i]
          if (sameMarkers(markers, elt.markers)) {
            markers = elt.markers
            localMarkers.length = 0
          }
          elt.update(text.height, above, markers)
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

  constructor(height: number, above: number, markers: ReadonlyArray<GutterMarker>) {
    this.dom = document.createElement("div")
    this.update(height, above, markers)
  }

  update(height: number, above: number, markers: ReadonlyArray<GutterMarker>) {
    if (this.height != height)
      this.dom.style.height = (this.height = height) + "px"
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
    if (this.markers != markers) {
      this.markers = markers
      for (let ch; ch = this.dom.lastChild;) ch.remove()
      let cls = "codemirror-gutter-element"
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

function sameMarkers<T>(a: ReadonlyArray<GutterMarker<T>>, b: ReadonlyArray<GutterMarker<T>>): boolean {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].eq(b[i])) return false
  return true
}

export interface LineNumberConfig {
  fixed?: boolean,
  formatNumber?: (lineNo: number) => string
}

export type LineNumberMarkerUpdate = {
  add?: Range<GutterMarker>[],
  filter?: (from: number, to: number, marker: GutterMarker) => boolean
}

export const lineNumberMarkers = Slot.define<LineNumberMarkerUpdate>()

export const lineNumbers = ViewExtension.unique<LineNumberConfig>(configs => {
  let config = combineConfig(configs, {
    fixed: true,
    formatNumber: String
  })
  class NumberMarker extends GutterMarker<number> {
    toDOM() {
      return document.createTextNode(config.formatNumber(this.value))
    }
  }
  return gutter({
    class: "codemirror-line-numbers " + styles.lineNumberGutter,
    fixed: config.fixed,
    updateMarkers(markers: GutterMarkerSet, update: ViewUpdate) {
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
      return max == spacer.value ? spacer : new NumberMarker(max)
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
    overflow: "hidden",

    "& > .codemirror-gutter-element": {
      boxSizing: "border-box"
    }
  },

  lineNumberGutter: {
    background: "#f5f5f5",
    borderRight: "1px solid silver",

    "& > .codemirror-gutter-element": {
      padding: "0 3px 0 5px",
      minWidth: "20px",
      textAlign: "right",
      color: "#999",
      whiteSpace: "nowrap"
    }    
  }
})
