import {EditorView, ViewPlugin, Decoration, MarkDecorationSpec, ViewUpdate} from "../../view"
import {Annotation} from "../../state"
import {hoverTooltip, HoverTooltip} from "../../tooltip"

export enum Severity { Hint, Warning, Error }
  
export interface Diagnostic {
  from: number
  to: number
  severity: Severity
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
    hoverTooltip((view, check) => view.plugin(plugin)!.hoverTooltip(view, check))
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
    let found: HoverTooltip | null = null
    this.diagnostics.between(0, view.state.doc.length, (start, end, {spec}) => {
      if (check(start, end)) found = {
        pos: start, end,
        dom: this.renderTooltip(spec.diagnostic as Diagnostic),
        hideOnChange: true
      }
    })
    return found
  }

  renderTooltip(diagnostic: Diagnostic) {
    let dom = document.createElement("div")
    dom.textContent = diagnostic.message
    return dom
  }
}
