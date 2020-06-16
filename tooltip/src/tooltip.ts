import {EditorView, ViewPlugin, ViewUpdate, themeClass, Direction} from "@codemirror/next/view"
import {StateEffect, StateEffectType, Facet, StateField, Extension, MapMode} from "@codemirror/next/state"

type Rect = {left: number, right: number, top: number, bottom: number}

type Measured = {
  editor: Rect,
  pos: (Rect | null)[],
  size: Rect[],
  innerWidth: number,
  innerHeight: number
}

const tooltipPlugin = ViewPlugin.fromClass(class {
  tooltips: readonly Tooltip[]
  tooltipViews: TooltipView[]
  measureReq: {read: () => Measured, write: (m: Measured) => void, key: any}

  constructor(readonly view: EditorView) {
    view.scrollDOM.addEventListener("scroll", this.onscroll = this.onscroll.bind(this))
    this.measureReq = {read: this.readMeasure.bind(this), write: this.writeMeasure.bind(this), key: this}
    this.tooltips = view.state.facet(showTooltip)
    this.tooltipViews = this.tooltips.map(tp => this.createTooltip(tp))
  }

  update(update: ViewUpdate) {
    let tooltips = update.state.facet(showTooltip)
    if (tooltips == this.tooltips) {
      for (let t of this.tooltipViews) if (t.update) t.update(update)
    } else {
      let views = []
      for (let i = 0; i < tooltips.length; i++) {
        let tip = tooltips[i], known = this.tooltips.findIndex(t => t.create == tip.create)
        if (known < 0) {
          views[i] = this.createTooltip(tip)
        } else {
          let tooltipView = views[i] = this.tooltipViews[known]
          if (tooltipView.update) tooltipView.update(update)
        }
      }
      for (let t of this.tooltipViews) if (views.indexOf(t) < 0) t.dom.remove()
      this.tooltips = tooltips
      this.tooltipViews = views
      if (this.tooltips.length) this.view.requestMeasure(this.measureReq)
    }

    if (update.docChanged && this.tooltips.length) this.view.requestMeasure(this.measureReq)
  }

  createTooltip(tooltip: Tooltip) {
    let tooltipView = tooltip.create(this.view)
    tooltipView.dom.className = themeClass("tooltip" + (tooltip.style ? "." + tooltip.style : ""))
    this.view.dom.appendChild(tooltipView.dom)
    if (tooltipView.mount) tooltipView.mount(this.view)
    return tooltipView
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onscroll)
    for (let {dom} of this.tooltipViews) dom.remove()
  }

  readMeasure() {
    return {
      editor: this.view.dom.getBoundingClientRect(),
      pos: this.tooltips.map(t => this.view.coordsAtPos(t.pos)),
      size: this.tooltipViews.map(({dom}) => dom.getBoundingClientRect()),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight
    }
  }

  writeMeasure(measured: Measured) {
    let {editor} = measured
    for (let i = 0; i < this.tooltipViews.length; i++) {
      let tooltip = this.tooltips[i], {dom} = this.tooltipViews[i], pos = measured.pos[i], size = measured.size[i]
      // Hide tooltips that are outside of the editor.
      if (!pos || pos.bottom <= editor.top || pos.top >= editor.bottom || pos.right <= editor.left || pos.left >= editor.right) {
        dom.style.top = "-10000px"
        continue
      }
      let width = size.right - size.left, height = size.bottom - size.top
      let left = this.view.textDirection == Direction.LTR ? Math.min(pos.left, measured.innerWidth - width)
        : Math.max(0, pos.left - width)
      let above = !!tooltip.above
      if (!tooltip.strictSide &&
          (above ? pos.top - (size.bottom - size.top) < 0 : pos.bottom + (size.bottom - size.top) > measured.innerHeight))
        above = !above
      dom.style.top = ((above ? pos.top - height : pos.bottom) - editor.top) + "px"
      dom.style.left = (left - editor.left) + "px"
    }
  }

  onscroll() {
    if (this.tooltips.length) this.view.requestMeasure(this.measureReq)
  }
})

const baseTheme = EditorView.baseTheme({
  tooltip: {
    position: "absolute",
    border: "1px solid silver",
    backgroundColor: "#f5f5f5",
    zIndex: 100
  }
})

/// Supporting extension for displaying tooltips. Allows
/// [`showTooltip`](#tooltip.showTooltip) to be used to define
/// tooltips.
export function tooltips(): Extension {
  return [tooltipPlugin, baseTheme]
}

/// Describes a tooltip. Values of this type, when provided through
/// the [`showTooltip`](#tooltip.showTooltip) facet, control the
/// individual tooltips on the editor.
export interface Tooltip {
  /// The document position at which to show the tooltip.
  pos: number
  /// The end of the range annotated by this tooltip, if different
  /// from `pos`.
  end?: number
  /// A constructor function that creates the tooltip's [DOM
  /// representation](#tooltip.TooltipView).
  create(view: EditorView): TooltipView
  /// An extra theme selector to use for the tooltip. By default,
  /// it'll be themed as `"tooltip"`, but you can pass a name, say
  /// `"mine"`, to style it as `"tooltip.mine"` instead.
  style?: string
  /// Whether the tooltip should be shown above or below the target
  /// position. Defaults to false.
  above?: boolean
  /// Whether the `above` option should be honored when there isn't
  /// enough space on that side to show the tooltip inside the
  /// viewport. Defaults to false.
  strictSide?: boolean
}

/// Describes the way a tooltip is displayed.
export interface TooltipView {
  /// The DOM element to position over the editor.
  dom: HTMLElement
  /// Called after the tooltip is added to the DOM for the first time.
  mount?(view: EditorView): void
  /// Update the DOM element for a change in the view's state.
  update?(update: ViewUpdate): void
}

/// Behavior by which an extension can provide a tooltip to be shown.
export const showTooltip = Facet.define<Tooltip>()

const HoverTime = 750, HoverMaxDist = 10

class HoverPlugin {
  lastMouseMove: MouseEvent | null = null
  hoverTimeout = -1
  mouseInside = false

  constructor(readonly view: EditorView,
              readonly source: (view: EditorView, check: (from: number, to: number) => boolean) => Tooltip | null,
              readonly field: StateField<Tooltip | null>,
              readonly setHover: StateEffectType<Tooltip | null>) {
    this.checkHover = this.checkHover.bind(this)
    view.dom.addEventListener("mouseenter", this.mouseenter = this.mouseenter.bind(this))
    view.dom.addEventListener("mouseleave", this.mouseleave = this.mouseleave.bind(this))
    view.dom.addEventListener("mousemove", this.mousemove = this.mousemove.bind(this))
  }

  get active() {
    return this.view.state.field(this.field)
  }

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
    if (open) this.view.dispatch(this.view.state.update({effects: this.setHover.of(open)}))
  }

  mousemove(event: MouseEvent) {
    this.lastMouseMove = event
    if (this.hoverTimeout < 0) this.hoverTimeout = setTimeout(this.checkHover, HoverTime)
    let tooltip = this.active
    if (tooltip && !isInTooltip(event.target as HTMLElement)) {
      let {pos} = tooltip, end = tooltip.end ?? pos
      if ((pos == end ? this.view.posAtCoords({x: event.clientX, y: event.clientY}) != pos
           : !isOverRange(this.view, pos, end, event.clientX, event.clientY, HoverMaxDist)))
        this.view.dispatch(this.view.state.update({effects: this.setHover.of(null)}))
    }
  }

  mouseenter() {
    this.mouseInside = true
  }

  mouseleave() {
    this.mouseInside = false
    if (this.active)
      this.view.dispatch(this.view.state.update({effects: this.setHover.of(null)}))
  }

  destroy() {
    this.view.dom.removeEventListener("mouseenter", this.mouseenter.bind(this))
    this.view.dom.removeEventListener("mouseleave", this.mouseleave.bind(this))
    this.view.dom.removeEventListener("mousemove", this.mousemove.bind(this))
  }
}

function isInTooltip(elt: HTMLElement) {
  for (let cur: Node | null = elt; cur; cur = cur.parentNode)
    if (cur.nodeType == 1 && (cur as HTMLElement).classList.contains("cm-tooltip")) return true
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
export function hoverTooltip(
  source: (view: EditorView, check: (from: number, to: number) => boolean) => Tooltip | null,
  options: {hideOnChange?: boolean} = {}
): Extension {
  const setHover = StateEffect.define<Tooltip | null>()
  const hoverState = StateField.define<Tooltip | null>({
    create() { return null },

    update(value, tr) {
      if (value && (options.hideOnChange && (tr.docChanged || tr.selection))) return null
      for (let effect of tr.effects) if (effect.is(setHover)) return effect.value
      if (value && tr.docChanged) {
        let newPos = tr.changes.mapPos(value.pos, -1, MapMode.TrackDel)
        if (newPos < 0) return null
        let copy: Tooltip = Object.create(null)
        for (let prop in value) (copy as any)[prop] = (value as any)[prop]
        copy.pos = newPos
        if (value.end != null) copy.end = tr.changes.mapPos(value.end)
        return copy
      }
      return value
    },

    provide: [showTooltip.nFrom(v => v ? [v] : [])]
  })

  return [
    hoverState,
    ViewPlugin.define(view => new HoverPlugin(view, source, hoverState, setHover)),
    tooltips()
  ]
}
