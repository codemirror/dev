import {EditorView, ViewPlugin, Decoration, DecorationSet, MarkDecorationSpec, WidgetDecorationSpec,
        WidgetType, ViewUpdate, Command} from "../../view"
import {Annotation, EditorSelection} from "../../state"
import {Extension} from "../../extension"
import {hoverTooltip} from "../../tooltip"
import {panels, openPanel} from "../../panel"

/// Describes a problem or hint for a piece of code.
export interface Diagnostic {
  /// The start position of the relevant text.
  from: number
  /// The end position. May be equal to `from`, though actually
  /// covering text is preferable.
  to: number
  /// The severity of the problem. This will influence how it is
  /// displayed.
  severity: "info" | "warning" | "error"
  /// An optional source string indicating where the diagnostic is
  /// coming from. You can put the name of your linter here, if
  /// applicable.
  source?: string
  /// The message associated with this diagnostic.
  message: string
  /// An optional array of actions that can be taken on this
  /// diagnostic.
  actions?: readonly Action[]
}

/// An action associated with a diagnostic.
export interface Action {
  /// The label to show to the user. Should be relatively short.
  name: string
  /// The function to call when the user activates this action. Is
  /// given the diagnostic's _current_ position, which may have
  /// changed since the creation of the diagnostic due to editing.
  apply: (view: EditorView, from: number, to: number) => void
}

/// Transaction annotation that is used to update the current set of
/// diagnostics.
export const setDiagnostics = Annotation.define<readonly Diagnostic[]>()

/// Returns an extension that enables the linting functionality.
/// Implicitly enabled by the [`linter`](#lint.linter) function.
export function linting(): Extension {
  return lintExtension
}

const lintPanel = Annotation.define<boolean>()

/// Command to open and focus the lint panel.
export const openLintPanel: Command = (view: EditorView) => {
  let plugin = view.plugin(lintPlugin)
  if (!plugin) return false
  if (!plugin.panel) view.dispatch(view.state.t().annotate(lintPanel(true)))
  if (plugin.panel) plugin.panel!.list.focus()
  return true
}

/// Command to close the lint panel, when open.
export const closeLintPanel: Command = (view: EditorView) => {
  let plugin = view.plugin(lintPlugin)
  if (!plugin || !plugin.panel) return false
  view.dispatch(view.state.t().annotate(lintPanel(false)))
  return true
}

const LintDelay = 500

/// Given a diagnostic source, this function returns an extension that
/// enables linting with that source. It will be called whenever the
/// editor is idle (after its content changed).
export function linter(source: (view: EditorView) => readonly Diagnostic[]): Extension {
  return [
    ViewPlugin.create(view => {
      let lintTime = Date.now() + LintDelay, set = true
      function run() {
        let now = Date.now()
        if (now < lintTime - 10) return setTimeout(run, lintTime - now)
        set = false
        view.dispatch(view.state.t().annotate(setDiagnostics(source(view))))
      }
      setTimeout(run, LintDelay)
      return {
        update(update: ViewUpdate) {
          if (update.docChanged) {
            lintTime = Date.now() + LintDelay
            if (!set) {
              set = true
              setTimeout(run, LintDelay)
            }
          }
        }
      }
    }).extension,
    linting()
  ]
}

class LintPlugin {
  diagnostics = Decoration.none
  panel: LintPanel | null = null

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    let diagnostics = update.annotation(setDiagnostics)
    if (diagnostics) {
      this.diagnostics = Decoration.set(diagnostics.map(d => {
        return d.from < d.to
          ? Decoration.mark(d.from, d.to, {
            attributes: {class: this.view.cssClass("diagnosticRange." + d.severity)},
            diagnostic: d
          } as MarkDecorationSpec)
          : Decoration.widget(d.from, {
            widget: new DiagnosticWidget(d),
            diagnostic: d
          } as WidgetDecorationSpec)
      }))
      if (this.panel) this.panel.update(this.diagnostics)
    } else if (update.docChanged) {
      this.diagnostics = this.diagnostics.map(update.changes)
      if (this.panel) this.panel.update(this.diagnostics)
    }

    let panel = update.annotation(lintPanel)
    if (panel != null)
      this.panel = panel ? new LintPanel(this, this.diagnostics) : null
  }

  draw() {
    if (this.panel) this.panel.draw()
  }

  get activeDiagnostic() {
    return this.panel ? this.panel.activeDiagnostic : Decoration.none
  }

  hoverTooltip(view: EditorView, check: (from: number, to: number) => boolean) {
    let found: Diagnostic[] = [], stackStart = 2e8, stackEnd = 0
    this.diagnostics.between(0, view.state.doc.length, (start, end, {spec}) => {
      if (check(start, end)) {
        found.push(spec.diagnostic)
        stackStart = Math.min(start, stackStart)
        stackEnd = Math.max(end, stackEnd)
      }
    })
    return found.length ? {
      pos: stackStart, end: stackEnd,
      dom: this.renderTooltip(found),
      style: "lint",
      hideOnChange: true
    } : null
  }

  renderTooltip(diagnostics: Diagnostic[]) {
    let dom = document.createElement("ul")
    for (let d of diagnostics) dom.appendChild(renderDiagnostic(this.view, d))
    return dom
  }

  findDiagnostic(diagnostic: Diagnostic): {from: number, to: number} | null {
    let found: {from: number, to: number} | null = null
    this.diagnostics.between(0, this.view.state.doc.length, (from, to, {spec}) => {
      if (spec.diagnostic == diagnostic) found = {from, to}
    })
    return found
  }
}

function renderDiagnostic(view: EditorView, diagnostic: Diagnostic) {
  let dom = document.createElement("li")
  dom.textContent = diagnostic.message
  dom.className = view.cssClass("diagnostic." + diagnostic.severity)
  if (diagnostic.actions) for (let action of diagnostic.actions) {
    let button = dom.appendChild(document.createElement("button"))
    button.className = view.cssClass("diagnosticAction")
    button.textContent = action.name
    button.onclick = button.onmousedown = e => {
      e.preventDefault()
      let plugin = view.plugin(lintPlugin)
      let found = plugin && plugin.findDiagnostic(diagnostic)
      if (found) action.apply(view, found.from, found.to)
    }
  }
  // FIXME render source?
  return dom
}

class DiagnosticWidget extends WidgetType<Diagnostic> {
  toDOM(view: EditorView) {
    let elt = document.createElement("span")
    elt.className = view.cssClass("diagnosticPoint." + this.value.severity)
    return elt
  }
}

class PanelItem {
  id = "item_" + Math.floor(Math.random() * 0xffffffff).toString(16)
  dom: HTMLElement

  constructor(view: EditorView, readonly diagnostic: Diagnostic) {
    this.dom = renderDiagnostic(view, diagnostic)
    this.dom.setAttribute("role", "option")
  }
}

class LintPanel {
  style = "lint"
  needsSync = true
  items: PanelItem[] = []
  selectedItem = -1
  dom: HTMLElement
  list: HTMLElement

  constructor(readonly parent: LintPlugin, readonly diagnostics: DecorationSet) {
    this.dom = document.createElement("div")
    this.list = this.dom.appendChild(document.createElement("ul"))
    this.list.tabIndex = 0
    this.list.setAttribute("role", "listbox")
    this.list.setAttribute("aria-label", this.view.phrase("Diagnostics"))
    this.list.addEventListener("keydown", event => {
      if (event.keyCode == 27) { // Escape
        event.preventDefault()
        closeLintPanel(this.view)
        this.view.focus()
      } else if (event.keyCode == 38) { // ArrowUp
        event.preventDefault()
        this.moveSelection((this.selectedItem - 1 + this.items.length) % this.items.length)
      } else if (event.keyCode == 40) { // ArrowDown
        event.preventDefault()
        this.moveSelection((this.selectedItem + 1) % this.items.length)
      } else if (event.keyCode == 36) { // Home
        event.preventDefault()
        this.moveSelection(0)
      } else if (event.keyCode == 35) { // End
        event.preventDefault()
        this.moveSelection(this.items.length - 1)
      } else if (event.keyCode == 13) {
        event.preventDefault()
        this.view.focus()
      } // FIXME PageDown/PageUp
    })
    this.list.addEventListener("click", event => {
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].dom.contains(event.target as HTMLElement))
          this.moveSelection(i)
      }
    })
    let close = this.dom.appendChild(document.createElement("button"))
    close.setAttribute("name", "close")
    close.setAttribute("aria-label", this.view.phrase("close"))
    close.textContent = "×"
    close.addEventListener("click", () => closeLintPanel(this.view))

    this.update(diagnostics)
  }

  get view() { return this.parent.view }

  update(diagnostics: DecorationSet) {
    let i = 0
    this.diagnostics.between(0, this.view.state.doc.length, (start, end, {spec}) => {
      let found = -1
      for (let j = i; j < this.items.length; j++)
        if (this.items[j].diagnostic == spec.diagnostic) { found = j; break }
      if (found < 0) {
        this.items.splice(i, 0, new PanelItem(this.view, spec.diagnostic))
      } else {
        if (this.selectedItem >= i && this.selectedItem < found) this.selectedItem = i
        if (found > i) this.items.splice(i, found - i)
        this.needsSync = true
      }
      i++
    })
    while (i < this.items.length) this.items.pop()
    if (this.selectedItem >= i || this.selectedItem < 0) this.selectedItem = i ? 0 : -1
  }

  draw() {
    if (!this.needsSync) return
    this.needsSync = false
    this.sync()
  }

  sync() {
    let domPos: ChildNode | null = this.list.firstChild
    function rm() {
      let prev = domPos!
      domPos = prev.nextSibling
      prev.remove()
    }

    for (let item of this.items) {
      if (item.dom.parentNode == this.list) {
        while (domPos != item.dom) rm()
        domPos = item.dom.nextSibling
      } else {
        this.list.insertBefore(item.dom, domPos)
      }
    }
    while (domPos) rm()
    if (!this.list.firstChild) this.list.appendChild(renderDiagnostic(this.view, {
      severity: "info",
      message: this.view.phrase("No diagnostics")
    } as Diagnostic))
    this.syncSelection()
  }

  moveSelection(selectedItem: number) {
    if (this.items.length == 0) return
    this.selectedItem = selectedItem
    this.syncSelection()
    let selected = this.items[this.selectedItem]
    let selRect = selected.dom.getBoundingClientRect(), panelRect = this.list.getBoundingClientRect()
    if (selRect.top < panelRect.top) this.list.scrollTop -= panelRect.top - selRect.top
    else if (selRect.bottom > panelRect.bottom) this.list.scrollTop += selRect.bottom - panelRect.bottom

    let found = this.parent.findDiagnostic(selected.diagnostic)
    if (found) this.view.dispatch(this.view.state.t().setSelection(EditorSelection.single(found.from, found.to)).scrollIntoView())
  }

  syncSelection() {
    let current = this.list.querySelector("[aria-selected]")
    let selected = this.items[this.selectedItem]
    if (current == (selected && selected.dom)) return
    if (current) current.removeAttribute("aria-selected")
    if (selected) selected.dom.setAttribute("aria-selected", "true")
    this.list.setAttribute("aria-activedescendant", selected ? selected.id : "")
  }

  get activeDiagnostic() {
    let found = this.selectedItem < 0 ? null : this.parent.findDiagnostic(this.items[this.selectedItem].diagnostic)
    return found && found.to > found.from
      ? Decoration.set(Decoration.mark(found.from, found.to, {class: this.view.cssClass("diagnosticRange.active")}))
      : Decoration.none
  }
}

function underline(color: string) {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3">
    <path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="${color}" fill="none" stroke-width=".7"/>
  </svg>`
  return `url('data:image/svg+xml;base64,${btoa(svg)}')`
}

const defaultTheme = EditorView.theme({
  diagnostic: {
    padding: "3px 6px 3px 8px",
    marginLeft: "-1px",
    display: "block"
  },
  "diagnostic.error": { borderLeft: "5px solid #d11" },
  "diagnostic.warning": { borderLeft: "5px solid orange" },
  "diagnostic.info": { borderLeft: "5px solid #999" },

  diagnosticAction: {
    font: "inherit",
    border: "none",
    padding: "2px 4px",
    background: "#444",
    color: "white",
    borderRadius: "3px",
    marginLeft: "8px"
  },

  diagnosticRange: {
    backgroundPosition: "left bottom",
    backgroundRepeat: "repeat-x"
  },

  "diagnosticRange.error": { backgroundImage: underline("#d11") },
  "diagnosticRange.warning": { backgroundImage: underline("orange") },
  "diagnosticRange.info": { backgroundImage: underline("#999") },
  "diagnosticRange.active": { backgroundColor: "#fec" },

  diagnosticPoint: {
    position: "relative",

    "&:after": {
      content: '""',
      position: "absolute",
      bottom: 0,
      left: "-2px",
      borderLeft: "3px solid transparent",
      borderRight: "3px solid transparent",
      borderBottom: "4px solid #d11"
    }
  },

  "diagnosticPoint.warning": {
    "&:after": { borderBottomColor: "orange" }
  },
  "diagnosticPoint.info": {
    "&:after": { borderBottomColor: "#999" }
  },

  "panel.lint": {
    position: "relative",
    "& ul": {
      maxHeight: "100px",
      overflowY: "auto",
      "& [aria-selected]": {
        background: "#ddd"
      },
      "&:focus [aria-selected]": {
        background_fallback: "#bdf",
        background: "Highlight",
        color_fallback: "white",
        color: "HighlightText"
      },
      padding: 0,
      margin: 0
    },
    "& [name=close]": {
      position: "absolute",
      top: "0",
      right: "2px",
      background: "inherit",
      border: "none",
      font: "inherit",
      padding: 0,
      margin: 0
    }
  },

  "tooltip.lint": {
    padding: 0,
    margin: 0
  }
})

const lintPlugin = ViewPlugin.create(view => new LintPlugin(view))
  .decorations(p => p.diagnostics)
  .decorations(p => p.activeDiagnostic)
  .behavior(openPanel, p => p.panel)

const lintExtension = [
  lintPlugin.extension,
  hoverTooltip((view, check) => view.plugin(lintPlugin)!.hoverTooltip(view, check)),
  panels(),
  defaultTheme
]
