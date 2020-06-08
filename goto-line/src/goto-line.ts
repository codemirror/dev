import {panels, Panel, getPanel, showPanel} from "@codemirror/next/panel"
import {StateField, StateEffect, EditorSelection} from "@codemirror/next/state"
import {EditorView, Command} from "@codemirror/next/view"

const setPanel = StateEffect.define<boolean>()

const panelStatus = StateField.define<readonly ((view: EditorView) => Panel)[]>({
  create() { return [] },
  update(status, tr) {
    for (let effect of tr.effects) if (effect.is(setPanel))
      status = effect.value ? [createLineDialog] : []
    return status
  },
  provide: [showPanel.nFrom(x => x)]
})

function createLineDialog(view: EditorView): Panel {
  let dom = document.createElement("form")
  dom.innerHTML = `<label>${view.state.phrase("Go to line:")} <input name=line type=number></label>
<button type=submit>${view.state.phrase("go")}</button>`
  let input = dom.querySelector("input") as HTMLInputElement

  function go() {
    let n = parseInt(input.value, 10)
    view.dispatch(view.state.update({
      effects: setPanel.of(false),
      selection: !isNaN(n) && n > 0 && n <= view.state.doc.lines ? EditorSelection.cursor(view.state.doc.line(n).start) : undefined
    }))
    view.focus()
  }
  dom.addEventListener("keydown", event => {
    if (event.keyCode == 27) { // Escape
      event.preventDefault()
      view.dispatch(view.state.update({effects: setPanel.of(false)}))
      view.focus()
    } else if (event.keyCode == 13) { // Enter
      event.preventDefault()
      go()
    }
  })
  dom.addEventListener("submit", go)

  return {dom, style: "goto-line", pos: -10}
}

export const openLineDialog: Command = view => {
  let field = view.state.field(panelStatus, false)
  if (!field) return false
  if (!field.length) view.dispatch(view.state.update({effects: setPanel.of(true)}))
  let dialog = getPanel(view, createLineDialog)
  if (dialog) dialog.dom.querySelector("input")!.focus()
  return true
}

export function gotoLine() { return [panels(), panelStatus, baseTheme] }

const baseTheme = EditorView.baseTheme({
  "panel.goto-line": {
    padding: "2px 6px 4px",
    position: "relative",
    "& input, & button": { verticalAlign: "middle" },
  }
})
