import {fillConfig, Full, Slot, SlotType} from "../../extension/src/extension"
import {EditorView, ViewExtension, ViewPlugin, ViewUpdate, styleModule, viewPlugin, BlockType, BlockInfo} from "../../view/src"
import {ChangeSet, MapMode} from "../../state/src"
import {StyleModule} from "style-mod"

// FIXME Think about how the gutter width changing could cause
// problems when line wrapping is on by changing a line's height
// (solution is possibly some way for this plugin to signal the view
// that it has to do another layout check when the gutter's width
// changes, which should be relatively rare)

export class GutterMarker<T> {
  constructor(readonly pos: number, readonly value: T) {}
}

export abstract class GutterMarkerType<T> {
  update: SlotType<{markers?: GutterMarker<T>[], replace?: {from: number, to: number}}>
  constructor() { this.update = Slot.define() }
  eq(a: T, b: T): boolean { return a === b }
  abstract toDOM(markers: ReadonlyArray<T>): Node
  make(pos: number, value: T) { return new GutterMarker(pos, value) }
}

export interface GutterConfig {
  class: string,
  marker: GutterMarkerType<any>
  fixed?: boolean,
  renderEmptyElements?: boolean
}

export function gutter<T>(config: GutterConfig): ViewExtension {
  let conf = fillConfig(config, {fixed: true, renderEmptyElements: false})
  return ViewExtension.all(
    viewPlugin(view => new GutterView(view, conf)),
    styleModule(styles)
  )
}

function mapMarkers(positions: number[], changes: ChangeSet) {
  if (changes.changes.length) for (let i = 0; i < positions.length; i++) {
    let pos = positions[i]
    if (pos > -1) {
      let newPos = changes.mapPos(pos, -1, MapMode.TrackBefore)
      if (newPos != pos) positions[i] = newPos < 0 ? -1 : newPos
    }
  }
}

function updateMarkers<T>(positions: number[], values: T[],
                          update: {markers?: GutterMarker<T>[], replace?: {from: number, to: number}}) {
  let newPositions: number[] = [], newValues: T[] = []
  let add = update.markers || [], replace = update.replace
  add.sort((a, b) => a.pos - b.pos)
  let addI = 0, oldI = 0
  for (;;) {
    let nextAdd = addI < add.length ? add[addI].pos : 2e8
    let nextOld = oldI < positions.length ? positions[oldI] : 2e8
    if (nextAdd <= nextOld) {
      if (nextAdd == 2e8) break
      newPositions.push(nextAdd)
      newValues.push(add[addI++].value)
    } else {
      if (nextOld > -1 && (!replace || replace.from > nextOld || replace.to < nextOld)) {
        newPositions.push(nextOld)
        newValues.push(values[oldI])
      }
      oldI++
    }
  }
  return {positions: newPositions, values: newValues}
}

class GutterView implements ViewPlugin {
  dom: HTMLElement
  elements: GutterElement[] = []
  markers: any[]
  markerPositions: number[]

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
    this.markers = [] // FIXME allow to initialize somehow?
    this.markerPositions = []
    this.updateGutter()
  }

  update(update: ViewUpdate) {
    for (let tr of update.transactions) {
      mapMarkers(this.markerPositions, tr.changes)
      let markerUpdate = tr.getMeta(this.config.marker.update)
      if (markerUpdate)
        ({values: this.markers, positions: this.markerPositions} = updateMarkers(this.markerPositions, this.markers, markerUpdate))
    }
    // FIXME would be nice to be able to recognize updates that didn't redraw
    this.updateGutter()
  }

  updateGutter() {
    let i = 0, height = 0
    let markerI = 0, localMarkers: any[] = []
    this.view.viewportLines(line => {
      let text: BlockInfo | undefined
      if (Array.isArray(line.type)) text = line.type.find(b => b.type == BlockType.Text)
      else text = line.type == BlockType.Text ? line : undefined
      if (!text) return

      while (markerI < this.markers.length && this.markerPositions[markerI] <= line.from) {
        if (this.markerPositions[markerI] == line.from) localMarkers.push(this.markers[markerI])
        markerI++
      }
      if (localMarkers.length || this.config.renderEmptyElements) {
        let above = text.top - height
        if (i == this.elements.length) {
          let newElt = new GutterElement(this.config, text.height, above, localMarkers)
          this.elements.push(newElt)
          this.dom.appendChild(newElt.dom)
        } else {
          this.elements[i].update(this.config, text.height, above, localMarkers)
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
  markers!: ReadonlyArray<any>

  constructor(config: Full<GutterConfig>, height: number, above: number, markers: ReadonlyArray<any>) {
    this.dom = document.createElement("div")
    this.dom.className = "codemirror-gutter-element"
    this.update(config, height, above, markers)
  }

  update(config: Full<GutterConfig>, height: number, above: number, markers: ReadonlyArray<any>) {
    if (this.height != height)
      this.dom.style.height = (this.height = height) + "px"
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
    if (!this.markers || !sameMarkers(config.marker, markers, this.markers)) {
      this.markers = markers
      for (let ch; ch = this.dom.lastChild;) ch.remove()
      if (markers.length) this.dom.appendChild(config.marker.toDOM(markers))
    }
  }
}

function sameMarkers<T>(type: GutterMarkerType<T>, a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (type.eq(a[i], b[i])) return false
  return true
}

/*
interface LineNumberConfig {
  fixed?: boolean,
  formatNumber?: (lineNo: number) => string
}

export const lineNumbers = ViewExtension.unique<LineNumberConfig>(configs => {
  let config = combineConfig(configs, {
    fixed: true,
    formatNumber: String
  })
  return ViewExtension.all(
    viewPlugin(view => new GutterView(view, config)),
    styleModule(styles)
  )
}, {})

class GutterView implements ViewPlugin {
  dom: HTMLElement
  lines: GutterLine[] = []
  lastLine: GutterLine
  formatNumber: (lineNo: number) => string

  constructor(public view: EditorView, config: Full<GutterConfig>) {
    this.dom = document.createElement("div")
    this.dom.className = "codemirror-gutter " + styles.gutter
    this.dom.setAttribute("aria-hidden", "true")
    this.dom.style.cssText = `left: 0; box-sizing: border-box; height: 100%; overflow: hidden; flex-shrink: 0;`
    if (config.fixed) {
      // FIXME IE11 fallback, which doesn't support position: sticky,
      // by using position: relative + event handlers that realign the
      // gutter (or just force fixed=false on IE11?)
      this.dom.style.position = "sticky"
    }
    view.dom.insertBefore(this.dom, view.contentDOM)
    this.lastLine = new GutterLine(1, 0, 0, this.formatNumber)
    this.lastLine.dom.style.cssText += "visibility: hidden; pointer-events: none"
    this.dom.appendChild(this.lastLine.dom)
    this.update()
  }

  update() {
    // Create the first number consisting of all 9s that is at least
    // as big as the line count, and put that in this.lastLine to make
    // sure the gutter width is stable
    let last = 9
    while (last < this.view.state.doc.lines) last = last * 10 + 9
    this.lastLine.update(last, 0, 0, this.formatNumber)
    // FIXME would be nice to be able to recognize updates that didn't redraw
    this.updateGutter()
  }

  updateGutter() {
    let i = 0, height = 0
    this.view.viewportLines(line => {
      let text: BlockInfo | undefined
      if (Array.isArray(line.type)) text = line.type.find(b => b.type == BlockType.Text)
      else text = line.type == BlockType.Text ? line : undefined
      if (!text) return
      let above = text.top - height
      // FIXME optimize (increment) when we can tell it's valid? (no replaced ranges)
      let lineNo = this.view.state.doc.lineAt(text.from).number
      if (i == this.lines.length) {
        let newLine = new GutterLine(lineNo, text.height, above, this.formatNumber)
        this.lines.push(newLine)
        this.dom.appendChild(newLine.dom)
      } else {
        this.lines[i].update(lineNo, text.height, above, this.formatNumber)
      }
      height = text.bottom
      i++
    }, 0)
    while (this.lines.length > i) this.dom.removeChild(this.lines.pop()!.dom)
    this.dom.style.minHeight = this.view.contentHeight + "px"
  }

  destroy() {
    this.dom.remove()
  }

  get styles() { return styles }
}

class GutterLine {
  dom: HTMLElement
  lineNo: number = -1
  height: number = -1
  above: number = 0
  below: number = 0

  constructor(lineNo: number, height: number, above: number) {
    this.dom = document.createElement("div")
    this.dom.className = "codemirror-gutter-element"
  }

  update(lineNo: number, height: number, above: number, config: Full<GutterConfig>) {
    if (this.lineNo != lineNo)
      this.dom.textContent = formatNo(this.lineNo = lineNo)
    if (this.height != height)
      this.dom.style.height = (this.height = height) + "px"
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
  }
}
*/

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
