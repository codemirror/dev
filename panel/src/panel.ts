import {EditorView, ViewPlugin, PluginField, ViewUpdate, themeClass} from "@codemirror/next/view"
import {Facet, Extension} from "@codemirror/next/state"

/// Configuration options passed to [`panels`](#panel.panels).
export type PanelConfig = {
  /// By default, panels will be placed inside the editor's DOM
  /// structure. You can use this option to override where panels with
  /// `top: true` are placed.
  topContainer?: HTMLElement
  /// Override where panels with `top: false` are placed.
  bottomContainer?: HTMLElement
}

const panelConfig = Facet.define<PanelConfig, PanelConfig>({
  combine(configs: readonly PanelConfig[]) {
    let topContainer, bottomContainer
    for (let c of configs) {
      topContainer = topContainer || c.topContainer
      bottomContainer = bottomContainer || c.bottomContainer
    }
    return {topContainer, bottomContainer}
  }
})

/// Enables the panel-managing extension.
export function panels(config?: PanelConfig): Extension {
  let ext = [panelPlugin, baseTheme]
  if (config) ext.push(panelConfig.of(config))
  return ext
}

/// Object that describes an active panel.
export interface Panel {
  /// The element representing this panel.
  dom: HTMLElement,
  /// Optionally called after the panel has been added to the editor.
  mount?(): void
  /// Update the DOM for a given view update.
  update?(update: ViewUpdate): void
  /// An optional theme selector. By default, panels are themed as
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
export const showPanel = Facet.define<(view: EditorView) => Panel>()

/// Get the active panel created by the given constructor, if any.
/// This can be useful when you need access to your panels' DOM
/// structure.
export function getPanel(view: EditorView, panel: (view: EditorView) => Panel) {
  let plugin = view.plugin(panelPlugin)
  let index = view.state.facet(showPanel).indexOf(panel)
  return plugin && index > -1 ? plugin.panels[index] : null
}

const panelPlugin = ViewPlugin.fromClass(class {
  specs: readonly ((view: EditorView) => Panel)[]
  panels: Panel[]
  top: PanelGroup
  bottom: PanelGroup

  constructor(view: EditorView) {
    this.specs = view.state.facet(showPanel)
    this.panels = this.specs.map(spec => spec(view))
    let conf = view.state.facet(panelConfig)
    this.top = new PanelGroup(view, true, conf.topContainer)
    this.bottom = new PanelGroup(view, false, conf.bottomContainer)
    this.top.sync(this.panels.filter(p => p.top))
    this.bottom.sync(this.panels.filter(p => !p.top))
    for (let p of this.panels) {
      p.dom.className += " " + panelClass(p)
      if (p.mount) p.mount()
    }
  }

  update(update: ViewUpdate) {
    let conf = update.state.facet(panelConfig)
    if (this.top.customDOM != conf.topContainer) {
      this.top.sync([])
      this.top = new PanelGroup(update.view, true, conf.topContainer)
    }
    if (this.bottom.customDOM != conf.bottomContainer) {
      this.bottom.sync([])
      this.bottom = new PanelGroup(update.view, false, conf.bottomContainer)
    }
    let specs = update.state.facet(showPanel)
    if (specs != this.specs) {
      let panels = [], top: Panel[] = [], bottom: Panel[] = [], mount = []
      for (let spec of specs) {
        let known = this.specs.indexOf(spec), panel
        if (known < 0) {
          panel = spec(update.view)
          mount.push(panel)
        } else {
          panel = this.panels[known]
          if (panel.update) panel.update(update)
        }
        panels.push(panel)
        ;(panel.top ? top : bottom).push(panel)
      }
      this.specs = specs
      this.panels = panels
      this.top.sync(top)
      this.bottom.sync(bottom)
      for (let p of mount) {
        p.dom.className += " " + panelClass(p)
        if (p.mount) p.mount!()
      }
    } else {
      for (let p of this.panels) if (p.update) p.update(update)
    }
  }

  destroy() {
    this.top.sync([])
    this.bottom.sync([])
  }
}).provide(PluginField.scrollMargins, value => ({top: value.top.scrollMargin(), bottom: value.bottom.scrollMargin()}))

function panelClass(panel: Panel) {
  return themeClass(panel.style ? `panel.${panel.style}` : "panel")
}

class PanelGroup {
  dom: HTMLElement | undefined = undefined
  panels: Panel[] = []

  constructor(readonly view: EditorView, readonly top: boolean, readonly customDOM: HTMLElement | undefined) {
    this.dom = this.customDOM
  }

  sync(panels: Panel[]) {
    this.panels = panels
    this.syncDOM()
  }

  syncDOM() {
    if (this.panels.length == 0) {
      if (this.customDOM) {
        for (let ch = this.customDOM.firstChild; ch; ch = rm(ch)) {}
      } else if (this.dom) {
        this.dom.remove()
        this.dom = undefined
      }
      return
    }

    if (!this.dom) {
      this.dom = document.createElement("div")
      this.dom.className = themeClass(this.top ? "panels.top" : "panels.bottom")
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
    return !this.dom || this.customDOM ? 0
      : Math.max(0, this.top ? this.dom.getBoundingClientRect().bottom - this.view.scrollDOM.getBoundingClientRect().top
                 : this.view.scrollDOM.getBoundingClientRect().bottom - this.dom.getBoundingClientRect().top)
  }
}

function rm(node: ChildNode) {
  let next = node.nextSibling
  node.remove()
  return next
}

const baseTheme = EditorView.baseTheme({
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
