import {EditorView, ViewPlugin, ViewUpdate} from "../../view"
import {Annotation} from "../../state"

/// Enables the panel-managing extension.
export function panels() {
  // FIXME indirection to work around plugin ordering issues
  return EditorView.extend.fallback(panelExt())
}

const panelExt = EditorView.extend.unique<null>(() => {
  return [panelPlugin.extension, EditorView.extend.fallback(EditorView.theme(defaultTheme))]
}, null)

/// Describe a newly created panel.
export interface PanelSpec {
  /// The DOM element that the panel should display.
  dom: HTMLElement,
  /// An optional theme style. By default, panels are themed as
  /// `"panel"`. If you pass `"foo"` here, your panel is themed as
  /// `"panel.foo"`.
  style?: string,
  /// Whether the panel should be at the top or bottom of the editor.
  /// Defaults to false.
  top?: boolean
  /// An optional number that is used to determine the ordering when
  /// there are multiple panels. Those with a lower `pos` value will
  /// come first. Defaults to 0.
  pos?: number
}

/// Opening a panel is done by providing an object describing the
/// panel through this behavior.
export const openPanel = EditorView.extend.behavior<PanelSpec | null, {top: readonly PanelSpec[], bottom: readonly PanelSpec[]}>({
  combine(specs) {
    let top: PanelSpec[] = [], bottom: PanelSpec[] = []
    for (let spec of specs) if (spec) (spec.top ? top : bottom).push(spec)
    return {top: top.sort((a, b) => (a.pos || 0) - (b.pos || 0)),
            bottom: bottom.sort((a, b) => (a.pos || 0) - (b.pos || 0))}
  }
})

const panelPlugin = ViewPlugin.create(view => new Panels(view)).behavior(EditorView.scrollMargins, p => p.scrollMargins())

class Panels {
  top: PanelGroup
  bottom: PanelGroup
  themeChanged = false

  constructor(view: EditorView) {
    let {top, bottom} = view.behavior(openPanel)
    this.top = new PanelGroup(view, true, top)
    this.bottom = new PanelGroup(view, false, bottom)
  }

  update(update: ViewUpdate) {
    let {top, bottom} = update.view.behavior(openPanel)
    this.top.update(top)
    this.bottom.update(bottom)
    if (update.themeChanged) this.themeChanged = true
  }

  draw() {
    this.top.draw(this.themeChanged)
    this.bottom.draw(this.themeChanged)
    this.themeChanged = false
  }

  destroy() {
    this.top.destroy()
    this.bottom.destroy()
  }

  scrollMargins() {
    return {top: this.top.scrollMargin(), bottom: this.bottom.scrollMargin()}
  }
}

class Panel {
  dom: HTMLElement
  style: string
  baseClass: string

  constructor(spec: PanelSpec) {
    this.dom = spec.dom
    this.style = spec.style || ""
    this.baseClass = spec.dom.className
  }
}

class PanelGroup {
  height = 0
  dom: HTMLElement | null = null
  panels: Panel[]
  scrollers: EventTarget[] = []
  floating = false
  needsSync: boolean

  constructor(readonly view: EditorView, readonly top: boolean, private specs: readonly PanelSpec[]) {
    this.onScroll = this.onScroll.bind(this)
    this.panels = specs.map(s => new Panel(s))
    this.needsSync = this.panels.length > 0
  }

  update(specs: readonly PanelSpec[]) {
    if (specs != this.specs) {
      this.panels = specs.map(s => new Panel(s))
      this.specs = specs
      this.needsSync = true
    }
  }

  removeListeners() {
    for (let target; target = this.scrollers.pop();)
      target.removeEventListener("scroll", this.onScroll)
  }

  addListeners() {
    this.scrollers = [window]
    for (let cur: Node | null = this.view.dom; cur; cur = cur.parentNode)
      this.scrollers.push(cur)
    for (let target of this.scrollers) target.addEventListener("scroll", this.onScroll)
  }

  syncDOM() {
    if (this.panels.length == 0) {
      if (this.dom) {
        this.dom.remove()
        this.dom = null
        this.removeListeners()
      }
      this.align()
      return
    }

    if (!this.dom) {
      this.dom = document.createElement("div")
      this.dom.className = this.view.cssClass(this.top ? "panels.top" : "panels.bottom")
      this.dom.style[this.top ? "top" : "bottom"] = "0"
      this.dontFloat()
      this.view.dom.insertBefore(this.dom, this.top ? this.view.dom.firstChild : null)
      this.addListeners()
    }

    let curDOM = this.dom.firstChild
    for (let panel of this.panels) {
      if (panel.dom.parentNode == this.dom) {
        while (curDOM != panel.dom) curDOM = rm(curDOM!)
        curDOM = curDOM!.nextSibling
      } else {
        this.dom.insertBefore(panel.dom, curDOM)
      }
    }
    while (curDOM) curDOM = rm(curDOM)
    this.align()
  }

  onScroll() {
    if (!this.dom) return

    // Check if the parents that have DOM listeners match the current parents
    for (let i = this.scrollers.length - 1, node: Node | null = this.view.dom; !(i == 1 && !node); i--, node = node.parentNode) {
      if (i == 1 || this.scrollers[i] != node) { // Mismatch
        this.removeListeners()
        if (document.contains(this.view.dom)) this.addListeners()
        break
      }
    }

    this.align()
  }

  dontFloat() {
    this.floating = false
    this.dom!.style.position = "absolute"
    this.dom!.style.left = this.dom!.style.right = "0"
    this.dom!.style.width = ""
  }

  align() {
    let height = this.dom ? this.dom.offsetHeight : 0
    if (height != this.height) {
      this.height = height
      this.view.dom.style[this.top ? "paddingTop" : "paddingBottom"] = height + "px"
    }
    if (!this.dom) return

    let editorRect = this.view.dom.getBoundingClientRect()
    let editorVisible = editorRect.top <= window.innerHeight - height && editorRect.bottom >= height
    let shouldFloat = editorVisible && (this.top ? editorRect.top < 0 : editorRect.bottom > window.innerHeight)
    if (this.floating && !shouldFloat) {
      this.dontFloat()
    } else if (!this.floating && shouldFloat) {
      this.floating = true
      this.dom.style.position = "fixed"
      let {left, width} = this.view.scrollDOM.getBoundingClientRect() // Without outer borders
      this.dom.style.left = left + "px"
      this.dom.style.right = ""
      this.dom.style.width = width + "px"
    }
  }

  draw(themeChanged: boolean) {
    if (this.needsSync) {
      this.syncDOM()
      this.needsSync = false
    }
    this.align()
    if (themeChanged && this.dom) {
      this.dom.className = this.view.cssClass(this.top ? "panels.top" : "panels.bottom")
      for (let {dom, style, baseClass} of this.panels)
        dom.className = baseClass + " " + this.view.cssClass("panel" + (style ? "." + style : ""))
    }
  }

  destroy() {
    this.removeListeners()
  }

  scrollMargin() {
    return this.floating ? this.height : 0
  }
}

function rm(node: ChildNode) {
  let next = node.nextSibling
  node.remove()
  return next
}

const defaultTheme = {
  panels: {
    background: "#f5f5f5",
    boxSizing: "border-box"
  },
  "panels.top": {
    borderBottom: "1px solid silver"
  },
  "panels.bottom": {
    borderTop: "1px solid silver"
  }
}
