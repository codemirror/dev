import {EditorView, ViewPlugin, ViewUpdate, themeClass} from "../../view"
import {EditorState, Facet} from "../../state"

/// Enables the panel-managing extension.
export function panels() { return [Panels.extension, defaultTheme] }

export interface Panel {
  /// The element representing this panel.
  dom: HTMLElement,
  /// Optionally called after the panel has been added to the editor.
  mount?(): void
  /// Update the DOM for a given view update.
  update?(update: ViewUpdate): void
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
export const showPanel = Facet.define<(view: EditorView) => Panel>()

class Panels extends ViewPlugin {
  specs: readonly ((view: EditorView) => Panel)[]
  panels: Panel[]
  top: PanelGroup
  bottom: PanelGroup

  constructor(view: EditorView) {
    super()
    this.specs = view.state.facet(showPanel)
    this.panels = this.specs.map(spec => spec(view))
    this.top = new PanelGroup(view, true, this.panels.filter(p => p.top)) 
    this.bottom = new PanelGroup(view, false, this.panels.filter(p => !p.top))
    for (let p of this.panels) {
      p.dom.className += " " + panelClass(view.state, p)
      if (p.mount) p.mount()
    }
  }

  update(update: ViewUpdate) {
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
        p.dom.className += " " + panelClass(update.state, p)
        if (p.mount) p.mount!()
      }
    } else {
      for (let p of this.panels) if (p.update) p.update(update)
    }

    if (update.themeChanged) for (let p of this.panels) {
      let prev = panelClass(update.prevState, p), cur = panelClass(update.state, p)
      if (prev != cur) {
        for (let cls of prev.split(" ")) p.dom.classList.remove(cls)
        for (let cls of cur.split(" ")) p.dom.classList.add(cls)
      }
    }
  }

  get scrollMargins() {
    return {top: this.top.scrollMargin(), bottom: this.bottom.scrollMargin()}
  }
}

function panelClass(state: EditorState, panel: Panel) {
  return themeClass(state, panel.style ? `panel.${panel.style}` : "panel")
}

class PanelGroup {
  dom: HTMLElement | null = null

  constructor(readonly view: EditorView, readonly top: boolean, public panels: Panel[]) {
    this.syncDOM()
  }

  sync(panels: Panel[]) {
    this.panels = panels
    this.syncDOM()
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
