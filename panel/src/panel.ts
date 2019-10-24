import {EditorView, ViewPlugin, ViewUpdate} from "../../view"

export const panels = EditorView.extend.unique<null>(() => {
  return [panelPlugin.extension, EditorView.extend.fallback(EditorView.theme(defaultTheme))]
}, null)

const panelPlugin = ViewPlugin.create(view => new Panels(view))

class Panels {
  top: PanelGroup
  bottom: PanelGroup
  themeChanged = false

  constructor(view: EditorView) {
    this.top = new PanelGroup(view, true)
    this.bottom = new PanelGroup(view, false)
  }

  openPanel(dom: HTMLElement, top: boolean, pos: number, style: string) {
    return (top ? this.top : this.bottom).openPanel(dom, pos, style)
  }

  update(update: ViewUpdate) {
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
}

class PanelGroup {
  height = 0
  dom: HTMLElement | null = null
  panels: {pos: number, dom: HTMLElement, style: string}[] = []
  scrollers: EventTarget[] = []
  floating = false

  constructor(readonly view: EditorView, readonly top: boolean) {
    this.onScroll = this.onScroll.bind(this)
  }

  openPanel(dom: HTMLElement, pos: number, style: string) {
    dom.className = this.view.cssClass("panel" + (style ? "." + style : ""))
    let panel = {pos, dom, style}, i = 0
    while (i < this.panels.length && this.panels[i].pos <= pos) i++
    this.panels.splice(i, 0, panel)
    this.syncDOM()
    return () => {
      let found = this.panels.indexOf(panel)
      if (found > -1) {
        this.panels.splice(found, 1)
        this.syncDOM()
      }
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
      this.dom.className = this.view.cssClass("panels")
      this.dom.style[this.top ? "top" : "bottom"] = "0"
      this.dontFloat()
      this.view.dom.insertBefore(this.dom, this.top ? this.view.dom.firstChild : null)
      this.addListeners()
    }

    let curDOM = this.dom.firstChild
    for (let panel of this.panels) {
      if (panel.dom.parentNode == this.dom) {
        while (curDOM != panel.dom) curDOM = rm(curDOM!)
        curDOM = curDOM.nextSibling
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
    this.align()
    if (themeChanged && this.dom) {
      this.dom.className = this.view.cssClass("panels")
      for (let {dom, style} of this.panels)
        dom.className = this.view.cssClass("panel" + (style ? "." + style : ""))
    }
  }

  destroy() {
    this.removeListeners()
  }
}

function rm(node: ChildNode) {
  let next = node.nextSibling
  node.remove()
  return next
}

export interface PanelSpec {
  dom: HTMLElement,
  style?: string,
  top?: boolean
  pos?: number
}

export function openPanel(view: EditorView, spec: PanelSpec) {
  let plugin = view.plugin(panelPlugin)
  if (!plugin) throw new Error("View doesn't have the panel extension")
  return plugin.openPanel(spec.dom, !!spec.top, spec.pos || 0, spec.style || "")
}

const defaultTheme = {
  panels: {
    background: "#f5f5f5",
    borderTop: "1px solid silver",
    boxSizing: "border-box"
  }
}
