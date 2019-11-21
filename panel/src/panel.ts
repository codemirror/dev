import {EditorView, ViewPlugin, ViewUpdate} from "../../view"

/// Enables the panel-managing extension.
export function panels() {
  // FIXME indirection to work around plugin ordering issues
  return EditorView.extend.fallback(panelExt)
}

const defaultTheme = EditorView.theme({
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
})

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

const panelExt = [panelPlugin.extension, EditorView.extend.fallback(defaultTheme)]

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

  scrollMargins() {
    return {top: this.top.scrollMargin(), bottom: this.bottom.scrollMargin()}
  }
}

class Panel {
  dom: HTMLElement
  style: string
  baseClass: string

  constructor(view: EditorView, spec: PanelSpec) {
    this.dom = spec.dom
    this.style = spec.style || ""
    this.baseClass = spec.dom.className
    this.setTheme(view)
  }

  setTheme(view: EditorView) {
    this.dom.className = this.baseClass + " " + view.cssClass("panel" + (this.style ? "." + this.style : ""))
  }
}

class PanelGroup {
  dom: HTMLElement | null = null
  panels: Panel[]
  floating = false
  needsSync: boolean

  constructor(readonly view: EditorView, readonly top: boolean, private specs: readonly PanelSpec[]) {
    this.panels = specs.map(s => new Panel(view, s))
    this.needsSync = this.panels.length > 0
  }

  update(specs: readonly PanelSpec[]) {
    if (specs != this.specs) {
      this.panels = specs.map(s => new Panel(this.view, s))
      this.specs = specs
      this.needsSync = true
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
      this.dom.className = this.view.cssClass(this.top ? "panels.top" : "panels.bottom")
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

  draw(themeChanged: boolean) {
    if (this.needsSync) {
      this.syncDOM()
      this.needsSync = false
    }
    if (themeChanged && this.dom) {
      this.dom.className = this.view.cssClass(this.top ? "panels.top" : "panels.bottom")
      for (let panel of this.panels) panel.setTheme(this.view)
    }
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
