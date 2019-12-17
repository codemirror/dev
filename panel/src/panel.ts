import {EditorView, ViewPlugin, ViewUpdate, themeClass} from "../../view"
import {Facet} from "../../state"

/// Enables the panel-managing extension.
export function panels() { return [Panels.extension, defaultTheme] }

/// Describe a newly created panel.
export interface PanelSpec {
  /// Create the DOM element that the panel should display.
  create(view: EditorView): HTMLElement
  /// Optionally called after the panel has been added to the editor.
  mount?(view: EditorView, dom: HTMLElement): void
  /// Update the DOM for a given view update.
  update?(update: ViewUpdate, dom: HTMLElement): void
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
/// panel through this facet.
export const openPanel = Facet.define<PanelSpec | null, {top: readonly PanelSpec[], bottom: readonly PanelSpec[]}>({
  combine(specs) {
    let top: PanelSpec[] = [], bottom: PanelSpec[] = []
    for (let spec of specs) if (spec) (spec.top ? top : bottom).push(spec)
    return {top: top.sort((a, b) => (a.pos || 0) - (b.pos || 0)),
            bottom: bottom.sort((a, b) => (a.pos || 0) - (b.pos || 0))}
  }
})

class Panels extends ViewPlugin {
  top: PanelGroup
  bottom: PanelGroup

  constructor(view: EditorView) {
    super()
    let {top, bottom} = view.state.facet(openPanel)
    this.top = new PanelGroup(view, true, top)
    this.bottom = new PanelGroup(view, false, bottom)
  }

  update(update: ViewUpdate) {
    let {top, bottom} = update.state.facet(openPanel)
    this.top.update(update, top)
    this.bottom.update(update, bottom)
  }

  get scrollMargins() {
    return {top: this.top.scrollMargin(), bottom: this.bottom.scrollMargin()}
  }
}

class Panel {
  dom: HTMLElement
  style: string
  baseClass: string

  constructor(view: EditorView, readonly spec: PanelSpec) {
    this.dom = spec.create(view)
    this.style = spec.style || ""
    this.baseClass = this.dom.className
    this.setTheme(view)
  }

  setTheme(view: EditorView) {
    this.dom.className = this.baseClass + " " + themeClass(view.state, "panel" + (this.style ? "." + this.style : ""))
  }

  update(update: ViewUpdate) {
    if (this.spec.update) this.spec.update(update, this.dom)
  }

  mount(view: EditorView) {
    if (this.spec.mount) this.spec.mount(view, this.dom)
  }
}

class PanelGroup {
  dom: HTMLElement | null = null
  panels: Panel[]
  floating = false

  constructor(readonly view: EditorView, readonly top: boolean, private specs: readonly PanelSpec[]) {
    this.panels = specs.map(s => new Panel(view, s))
    this.syncDOM()
    for (let panel of this.panels) panel.mount(view)
  }

  update(update: ViewUpdate, specs: readonly PanelSpec[]) {
    if (specs == this.specs) {
      for (let panel of this.panels) panel.update(update)
    } else {
      let panels: Panel[] = [], mount = []
      for (let spec of specs) {
        let found = -1
        for (let i = 0; i < this.panels.length; i++) if (this.panels[i].spec == spec) found = i
        if (found < 0) {
          let panel = new Panel(this.view, spec)
          panels.push(panel)
          mount.push(panel)
        } else {
          let panel = this.panels[found]
          panels.push(panel)
          panel.update(update)
        }
      }
      for (let panel of this.panels) if (panels.indexOf(panel) < 0) panel.dom.remove()
      this.specs = specs
      this.panels = panels
      this.syncDOM()
      for (let panel of mount) panel.mount(this.view)
    }
    if (update.themeChanged && this.dom) {
      this.dom.className = themeClass(this.view.state, this.top ? "panels.top" : "panels.bottom")
      for (let panel of this.panels) panel.setTheme(this.view)
    }
  }

  syncDOM() {
    if (this.panels.length == 0) {
      if (this.dom) {
        this.dom.remove()
        this.dom = null
      }
      return
    }

    if (!this.dom) {
      this.dom = document.createElement("div")
      this.dom.className = themeClass(this.view.state, this.top ? "panels.top" : "panels.bottom")
      this.dom.style[this.top ? "top" : "bottom"] = "0"
      this.view.dom.insertBefore(this.dom, this.top ? this.view.dom.firstChild : null)
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
  }

  scrollMargin() {
    return !this.dom ? 0 : Math.max(0, this.top
                                    ? this.dom.getBoundingClientRect().bottom - this.view.scrollDOM.getBoundingClientRect().top
                                    : this.view.scrollDOM.getBoundingClientRect().bottom - this.dom.getBoundingClientRect().top)
  }
}

function rm(node: ChildNode) {
  let next = node.nextSibling
  node.remove()
  return next
}

const defaultTheme = Facet.fallback(EditorView.theme({
  panels: {
    background: "#f5f5f5",
    boxSizing: "border-box",
    position: "sticky",
    left: 0,
    right: 0
  },
  "panels.top": {
    borderBottom: "1px solid silver"
  },
  "panels.bottom": {
    borderTop: "1px solid silver"
  }
}))
