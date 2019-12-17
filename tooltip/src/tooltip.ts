import {EditorView, ViewPlugin, ViewUpdate, themeClass} from "../../view"
import {Annotation, Facet, StateField} from "../../state"

const HoverTime = 750, HoverMaxDist = 10

type Rect = {left: number, right: number, top: number, bottom: number}

type Measured = {
  editor: Rect,
  pos: (Rect | null)[],
  size: Rect[],
  innerWidth: number,
  innerHeight: number
}

class TooltipPlugin extends ViewPlugin {
  sourceArray: readonly (Tooltip | null)[]
  tooltips: Tooltip[]
  elements: HTMLElement[]
  measureReq: {read: () => Measured, write: (m: Measured) => void, key: TooltipPlugin}

  constructor(readonly view: EditorView) {
    super()
    view.scrollDOM.addEventListener("scroll", this.onscroll = this.onscroll.bind(this))
    this.measureReq = {read: this.readMeasure.bind(this), write: this.writeMeasure.bind(this), key: this}
    this.sourceArray = view.state.facet(showTooltip)
    this.tooltips = this.sourceArray.filter(x => x) as Tooltip[]
    this.elements = this.tooltips.map(t => this.createTooltip(t))
  }

  update(update: ViewUpdate) {
    let source = update.state.facet(showTooltip)
    if (source == this.sourceArray) {
      for (let i = 0; i < this.tooltips.length; i++) {
        let tooltip = this.tooltips[i]
        if (tooltip.update) tooltip.update(update, this.elements[i])
      }
    } else {
      let tooltips = source.filter(x => x) as Tooltip[]
      let elements: HTMLElement[] = []
      for (let i = 0; i < tooltips.length; i++) {
        let tooltip = tooltips[i], known = this.tooltips.indexOf(tooltip)
        if (known < 0) {
          elements[i] = this.createTooltip(tooltip)
        } else {
          elements[i] = this.elements[known]
          if (tooltip.update) tooltip.update(update, elements[i])
        }
      }
      for (let i = 0; i < this.elements.length; i++) {
        let element = this.elements[i]
        if (!elements.some(e => e == element)) element.remove()
      }
      this.sourceArray = source
      this.tooltips = tooltips
      this.elements = elements
      if (this.tooltips.length) this.view.requestMeasure(this.measureReq)
    }

    if (update.docChanged && this.tooltips.length) this.view.requestMeasure(this.measureReq)
    if (update.themeChanged) this.themeChanged()
  }

  createTooltip(tooltip: Tooltip) {
    let dom = tooltip.create(this.view)
    dom.className = themeClass(this.view.state, "tooltip" + (tooltip.style ? "." + tooltip.style : ""))
    this.view.dom.appendChild(dom)
    if (tooltip.mount) tooltip.mount(this.view, dom)
    return dom
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onscroll)
    for (let elt of this.elements) elt.remove()
  }

  themeChanged() {
    for (let i = 0; i < this.tooltips.length; i++) {
      let elt = this.elements[i], tooltip = this.tooltips[i]
      elt.className = themeClass(this.view.state, "tooltip" + (tooltip.style ? "." + tooltip.style : ""))
    }
  }

  readMeasure() {
    return {
      editor: this.view.dom.getBoundingClientRect(),
      pos: this.tooltips.map(tooltip => this.view.coordsAtPos(tooltip.pos)),
      size: this.elements.map(elt => elt.getBoundingClientRect()),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight
    }
  }

  writeMeasure(measured: Measured) {
    let {editor} = measured
    for (let i = 0; i < this.tooltips.length; i++) {
      let tooltip = this.tooltips[i], elt = this.elements[i], pos = measured.pos[i], size = measured.size[i]
      // Hide tooltips that are outside of the editor.
      if (!pos || pos.bottom <= editor.top || pos.top >= editor.bottom || pos.right <= editor.left || pos.left >= editor.right) {
        elt.style.top = "-10000px"
        continue
      }
      let width = size.right - size.left, height = size.bottom - size.top
      let align = pos.left + width < measured.innerWidth
      let above = !!tooltip.above
      if (!tooltip.strictSide &&
          (above ? pos.top - (size.bottom - size.top) < 0 : pos.bottom + (size.bottom - size.top) > measured.innerHeight))
        above = !above
      elt.style.left = ((align ? pos.left : measured.innerWidth - width) - editor.left) + "px"
      elt.style.top = ((above ? pos.top - height : pos.bottom) - editor.top) + "px"
    }
  }

  onscroll() {
    if (this.tooltips.length) this.view.requestMeasure(this.measureReq)
  }
}

const tooltipExt = [
  TooltipPlugin.extension,
  EditorView.theme({
    tooltip: {
      position: "absolute",
      border: "1px solid silver",
      background: "#f5f5f5",
      zIndex: 100
    }
  })
]

/// Supporting extension for displaying tooltips. Allows
/// [`showTooltip`](#tooltip.showTooltip) to be used to define
/// tooltips.
export function tooltips() {
  return tooltipExt
}

/// Describes a tooltip.
export interface Tooltip {
  /// Create the DOM element to position over the editor.
  create(view: EditorView): HTMLElement
  /// Called after the tooltip is added to the DOM for the first time.
  mount?(view: EditorView, dom: HTMLElement): void
  /// Update the DOM element for a change in the view's state.
  update?(update: ViewUpdate, dom: HTMLElement): void
  /// The document position at which to show the tooltip.
  pos: number
  /// An extra theme style to use for the tooltip. By default, it'll
  /// be themed as `"tooltip"`, but you can pass a name, say `"mine"`,
  /// to style it as `"tooltip.mine"` instead.
  style?: string
  /// Whether the tooltip should be shown above or below the target
  /// position. Defaults to false.
  above?: boolean
  /// Whether the `above` option should be honored when there isn't
  /// enough space on that side to show the tooltip inside the
  /// viewport. Defaults to false.
  strictSide?: boolean
}

// Behavior by which an extension can provide a tooltip to be shown.
export const showTooltip = Facet.define<Tooltip | null>()

/// Hover tooltips are associated with a range, rather than a single
/// position.
export interface HoverTooltip extends Tooltip {
  /// The end of the target range. The tooltip will be hidden when the
  /// pointer is no longer over this range.
  end: number
  /// Whether to automatically hide the tooltip when the editor
  /// selection or content changes. Defaults to false.
  hideOnChange?: boolean
}

class HoverPlugin extends ViewPlugin {
  lastMouseMove: MouseEvent | null = null
  hoverTimeout = -1
  mouseInside = false

  constructor(readonly view: EditorView,
              readonly source: (view: EditorView, check: (from: number, to: number) => boolean) => HoverTooltip | null,
              readonly field: StateField<HoverTooltip | null>,
              readonly setHover: (t: HoverTooltip | null) => Annotation<HoverTooltip | null>) {
    super()
    this.checkHover = this.checkHover.bind(this)
    view.dom.addEventListener("mouseenter", this.mouseenter = this.mouseenter.bind(this))
    view.dom.addEventListener("mouseleave", this.mouseleave = this.mouseleave.bind(this))
    view.dom.addEventListener("mousemove", this.mousemove = this.mousemove.bind(this))
    this.mouseleave = this.mouseleave.bind(this)
  }

  get active() { return this.view.state.field(this.field) }

  checkHover() {
    this.hoverTimeout = -1
    if (!this.mouseInside || this.active) return
    let now = Date.now(), lastMove = this.lastMouseMove!
    if (now - lastMove.timeStamp < HoverTime) {
      this.hoverTimeout = setTimeout(this.checkHover, HoverTime - (now - lastMove.timeStamp))
      return
    }

    let pos = this.view.contentDOM.contains(lastMove.target as HTMLElement)
      ? this.view.posAtCoords({x: lastMove.clientX, y: lastMove.clientY}) : -1
    let open = pos < 0 ? null : this.source(this.view, (from, to) => {
      return from <= pos && to >= pos && (from == to || isOverRange(this.view, from, to, lastMove.clientX, lastMove.clientY))
    })
    if (open) this.view.dispatch(this.view.state.t().annotate(this.setHover(open)))
  }

  mousemove(event: MouseEvent) {
    this.lastMouseMove = event
    if (this.hoverTimeout < 0) this.hoverTimeout = setTimeout(this.checkHover, HoverTime)
    if (this.active && isInTooltip(event.target as HTMLElement) &&
        (this.active.pos == this.active.end
         ? this.view.posAtCoords({x: event.clientX, y: event.clientY}) != this.active.pos
         : !isOverRange(this.view, this.active.pos, this.active.end, event.clientX, event.clientY, HoverMaxDist)))
      this.view.dispatch(this.view.state.t().annotate(this.setHover(null)))
  }

  mouseenter() {
    this.mouseInside = true
  }

  mouseleave() {
    this.mouseInside = false
    if (this.active)
      this.view.dispatch(this.view.state.t().annotate(this.setHover(null)))
  }

  destroy() {
    this.view.dom.removeEventListener("mouseenter", this.mouseenter.bind(this))
    this.view.dom.removeEventListener("mouseleave", this.mouseleave.bind(this))
    this.view.dom.removeEventListener("mousemove", this.mousemove.bind(this))
  }
}

function isInTooltip(elt: HTMLElement) {
  for (let cur: Node | null = elt; cur; cur = cur.parentNode)
    if (cur.nodeType == 1 && (cur as HTMLElement).classList.contains("codemirror-tooltip")) return true
  return false
}

function isOverRange(view: EditorView, from: number, to: number, x: number, y: number, margin = 0) {
  let range = document.createRange()
  let fromDOM = view.domAtPos(from), toDOM = view.domAtPos(to)
  range.setEnd(toDOM.node, toDOM.offset)
  range.setStart(fromDOM.node, fromDOM.offset)
  let rects = range.getClientRects()
  for (let i = 0; i < rects.length; i++) {
    let rect = rects[i]
    let dist = Math.max(rect.top - y, y - rect.bottom, rect.left - x, x - rect.right)
    if (dist <= margin) return true
  }
  return false
}

/// Enable a hover tooltip, which shows up when the pointer hovers
/// over ranges of text. The callback should, for each hoverable
/// range, call its `check` argument to see if that range is being
/// hovered over, and return a tooltip description when it is.
export function hoverTooltip(source: (view: EditorView, check: (from: number, to: number) => boolean) => HoverTooltip | null) {
  const setHover = Annotation.define<HoverTooltip | null>()
  const hoverState = StateField.define<HoverTooltip | null>({
    create() { return null },

    update(value, tr) {
      if (value && value.hideOnChange && (tr.docChanged || tr.selectionSet)) return null
      let set = tr.annotation(setHover)
      return set === undefined ? value : set
    }
  })

  return [
    hoverState,
    showTooltip.derive([hoverState], state => state.field(hoverState)),
    EditorView.viewPlugin.of(view => new HoverPlugin(view, source, hoverState, setHover)),
    tooltips()
  ]
}
