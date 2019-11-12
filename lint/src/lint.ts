import {EditorView, ViewPlugin, Decoration, MarkDecorationSpec, ViewUpdate} from "../../view"
import {Annotation} from "../../state"
import {hoverTooltip, HoverTooltip} from "../../tooltip"

export interface Diagnostic {
  from: number
  to: number
  severity: "info" | "warning" | "error"
  source?: string
  message: string
  actions?: readonly Action[]
}

export interface Action {
  name: string
  apply: (view: EditorView, from: number, to: number) => void
}

export const setDiagnostics = Annotation.define<readonly Diagnostic[]>()

export const lint = EditorView.extend.unique<null>(() => {
  let plugin = ViewPlugin.create(view => new LintPlugin(view)).decorations(p => p.diagnostics)
  return [
    plugin.extension,
    hoverTooltip((view, check) => view.plugin(plugin)!.hoverTooltip(view, check)),
    EditorView.theme(defaultTheme)
  ]
}, null)

class LintPlugin {
  diagnostics = Decoration.none

  constructor(readonly view: EditorView) {
    
  }

  update(update: ViewUpdate) {
    let diagnostics = update.annotation(setDiagnostics)
    if (diagnostics) {
      this.diagnostics = Decoration.set(diagnostics.map(d => Decoration.mark(d.from, d.to, {
        attributes: {style: "text-decoration: underline"},
        diagnostic: d
      } as MarkDecorationSpec)))
    } else {
      this.diagnostics = this.diagnostics.map(update.changes)
    }
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

  renderDiagnostic(diagnostic: Diagnostic) {
    let dom = document.createElement("div")
    dom.textContent = diagnostic.message
    dom.className = this.view.cssClass("diagnostic." + diagnostic.severity)
    return dom
  }

  renderTooltip(diagnostics: Diagnostic[]) {
    let dom = document.createElement("div")
    for (let d of diagnostics) dom.appendChild(this.renderDiagnostic(d))
    return dom
  }
}

const defaultTheme = {
  "tooltip.lint": {
    borderLeft: "none"
  },

  diagnostic: {
    padding: "3px 6px 3px 8px"
  },

  "diagnostic.error": {
    borderLeft: "2px solid #b11"
  },

  "diagnostic.warning": {
    borderLeft: "2px solid orange"
  }
}
