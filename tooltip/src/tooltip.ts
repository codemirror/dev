import {EditorView, ViewPlugin, ViewUpdate} from "../../view"
import {Annotation} from "../../state"

const tooltipPlugin = ViewPlugin.create(view => new TooltipPlugin(view))

/// Supporting extension for displaying tooltips. Allows
/// [`showTooltip`](#tooltip.showTooltip) and
/// [`hideTooltip`](#tooltip.hideTooltip) to be used to control
/// tooltips.
export const tooltips = EditorView.extend.unique<null>(() => [
  tooltipPlugin.extension,
  EditorView.theme(theme)
], null)

/// Describes a tooltip.
export interface Tooltip {
  /// The DOM element to position over the editor.
  dom: HTMLElement
  /// The document position at which to show the tooltip.
  pos: number
  /// An extra theme style to use for the tooltip. By default, it'll
  /// be themed as `"tooltip"`, but you can pass a name, say `"mine"`,
  /// to style it as `"tooltip.mine"` instead.
  style?: string
  /// Whether the tooltip should be shown above or below the target
  /// position. If not specified, it will be shown below unless there
  /// isn't enough space there.
  above?: boolean
}

// Behavior by which an extension can provide a tooltip to be shown.
export const showTooltip = EditorView.extend.behavior<Tooltip | null>()

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

/// Enable a hover tooltip, which shows up when the pointer hovers
/// over ranges of text. The callback should, for each hoverable
/// range, call its `check` argument to see if that range is being
/// hovered over, and return a tooltip description when it is.
export function hoverTooltip(source: (view: EditorView, check: (from: number, to: number) => boolean) => HoverTooltip | null) {
  let plugin = ViewPlugin.create(view => new HoverPlugin(view, source)).behavior(showTooltip, p => p.active)
  return [
    plugin.extension,
    tooltips()
  ]
}

class HoverPlugin {
  lastMouseMove: MouseEvent | null = null
  hoverTimeout = -1
  mouseInside = false
  active: HoverTooltip | null = null
  setHover = Annotation.define<HoverTooltip | null>()

  constructor(readonly view: EditorView,
              readonly source: (view: EditorView, check: (from: number, to: number) => boolean) => HoverTooltip | null) {
    this.checkHover = this.checkHover.bind(this)
    view.dom.addEventListener("mouseenter", this.mouseenter = this.mouseenter.bind(this))
    view.dom.addEventListener("mouseleave", this.mouseleave = this.mouseleave.bind(this))
    view.dom.addEventListener("mousemove", this.mousemove = this.mousemove.bind(this))
    this.mouseleave = this.mouseleave.bind(this)
  }

  update(update: ViewUpdate) {
    if (this.active && this.active.hideOnChange && (update.docChanged || update.transactions.some(t => t.selectionSet)))
      this.active = null
    let set = update.annotation(this.setHover)
    if (set !== undefined) this.active = set
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
      return from <= pos && to >= pos && isOverRange(this.view, from, to, lastMove.clientX, lastMove.clientY)
    })
    if (open) this.view.dispatch(this.view.state.t().annotate(this.setHover(open)))
  }

  mousemove(event: MouseEvent) {
    this.lastMouseMove = event
    if (this.hoverTimeout < 0) this.hoverTimeout = setTimeout(this.checkHover, HoverTime)
    if (this.active && !this.active.dom.contains(event.target as HTMLElement) &&
        !isOverRange(this.view, this.active.pos, this.active.end, event.clientX, event.clientY, HoverMaxDist))
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

const HoverTime = 750, HoverMaxDist = 10

type Rect = {left: number, right: number, top: number, bottom: number}

type Measured = {
  editor: Rect,
  pos: Rect[],
  size: Rect[],
  innerWidth: number,
  innerHeight: number
}

class TooltipPlugin {
  tooltips: Tooltip[] = []
  sourceArray: readonly (Tooltip | null)[] = []
  added: HTMLElement[] = []

  mustSync = false
  themeChanged = false
  mustMeasure = false

  constructor(readonly view: EditorView) {
    view.scrollDOM.addEventListener("scroll", this.onscroll = this.onscroll.bind(this))
  }

  update(update: ViewUpdate) {
    let source = update.view.behavior(showTooltip)
    if (source != this.sourceArray) {
      this.sourceArray = source
      this.tooltips = source.filter(x => x) as Tooltip[]
      this.mustSync = true
    }
    if (update.docChanged) this.mustMeasure = true
    if (update.themeChanged) this.themeChanged = true
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onscroll)
  }

  draw() {
    if (this.themeChanged) {
      this.themeChanged = false
      for (let tooltip of this.tooltips)
        tooltip.dom.className = this.view.cssClass("tooltip" + (tooltip.style ? "." + tooltip.style : ""))
    }

    if (!this.mustSync) return
    this.mustSync = false
    for (let tooltip of this.tooltips) {
      if (this.added.indexOf(tooltip.dom) < 0) {
        tooltip.dom.className = this.view.cssClass("tooltip" + (tooltip.style ? "." + tooltip.style : ""))
        this.view.dom.appendChild(tooltip.dom)
        this.added.push(tooltip.dom)
      }
    }
    for (let i = 0; i < this.added.length; i++) {
      let element = this.added[i]
      if (!this.tooltips.some(t => t.dom == element)) {
        element.remove()
        this.added.splice(i--, 1)
      }
    }
    this.mustMeasure = true
  }

  measure() {
    if (!this.mustMeasure || !this.tooltips.length) return null
    return {
      editor: this.view.dom.getBoundingClientRect(),
      pos: this.tooltips.map(tooltip => this.view.coordsAtPos(tooltip.pos)),
      size: this.tooltips.map(tooltip => tooltip.dom.getBoundingClientRect()),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight
    }
  }

  drawMeasured(measured: null | Measured) {
    if (!measured) return false
    this.mustMeasure = false
    let {editor} = measured
    for (let i = 0; i < this.tooltips.length; i++) {
      let tooltip = this.tooltips[i], pos = measured.pos[i], size = measured.size[i]
      // Hide tooltips that are outside of the editor.
      if (pos.bottom <= editor.top || pos.top >= editor.bottom || pos.right <= editor.left || pos.left >= editor.right) {
        tooltip.dom.style.top = "-10000px"
        continue
      }
      let width = size.right - size.left, height = size.bottom - size.top
      let align = pos.left + width < measured.innerWidth
      let above = tooltip.above != null ? tooltip.above : pos.bottom + (size.bottom - size.top) > measured.innerHeight
      tooltip.dom.style.left = ((align ? pos.left : measured.innerWidth - width) - editor.left) + "px"
      tooltip.dom.style.top = ((above ? pos.top - height : pos.bottom) - editor.top) + "px"
    }
    return false
  }

  onscroll() {
    if (this.tooltips.length) {
      this.mustMeasure = true
      this.view.requireMeasure()
    }
  }
}

const theme = {
  tooltip: {
    position: "absolute",
    border: "1px solid silver",
    background: "#f5f5f5"
  }
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
