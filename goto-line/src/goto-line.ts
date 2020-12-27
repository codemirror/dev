import {panels, Panel, getPanel, showPanel} from "@codemirror/next/panel"
import {EditorSelection, StateField, StateEffect} from "@codemirror/next/state"
import {EditorView, Command, themeClass, KeyBinding} from "@codemirror/next/view"

function createLineDialog(view: EditorView): Panel {
  let dom = document.createElement("form")
  dom.innerHTML = `<label>${view.state.phrase("Go to line:")} <input class=${themeClass("textfield")} name=line></label>
<button class=${themeClass("button")} type=submit>${view.state.phrase("go")}</button>`
  let input = dom.querySelector("input") as HTMLInputElement

  function go() {
    let match = /^([+-])?(\d+)?(:\d+)?(%)?$/.exec(input.value)
    if (!match) return
    let {state} = view, startLine = state.doc.lineAt(state.selection.main.head)
    let [, sign, ln, cl, percent] = match
    let col = cl ? +cl.slice(1) : 0
    let line = ln ? +ln : startLine.number
    if (ln && percent) {
      let pc = line / 100
      if (sign) pc = pc * (sign == "-" ? -1 : 1) + (startLine.number / state.doc.lines)
      line = Math.round(state.doc.lines * pc)
    } else if (ln && sign) {
      line = line * (sign == "-" ? -1 : 1) + startLine.number
    }
    let docLine = state.doc.line(Math.max(1, Math.min(state.doc.lines, line)))
    view.dispatch({
      effects: dialogEffect.of(false),
      selection: EditorSelection.cursor(docLine.from + Math.max(0, Math.min(col, docLine.length))),
      scrollIntoView: true
    })
    view.focus()
  }
  dom.addEventListener("keydown", event => {
    if (event.keyCode == 27) { // Escape
      event.preventDefault()
      view.dispatch({effects: dialogEffect.of(false)})
      view.focus()
    } else if (event.keyCode == 13) { // Enter
      event.preventDefault()
      go()
    }
  })
  dom.addEventListener("submit", go)

  return {dom, style: "gotoLine", pos: -10}
}

const dialogEffect = StateEffect.define<boolean>()

const dialogField = StateField.define<boolean>({
  create() { return true },
  update(value, tr) {
    for (let e of tr.effects) if (e.is(dialogEffect)) value = e.value
    return value
  },
  provide: f => showPanel.computeN([f], s => s.field(f) ? [createLineDialog] : [])
})

/// Command that shows a dialog asking the user for a line number, and
/// when a valid position is provided, moves the cursor to that line.
///
/// Supports line numbers, relative line offsets prefixed with `+` or
/// `-`, document percentages suffixed with `%`, and an optional
/// column position by adding `:` and a second number after the line
/// number.
///
/// The dialog can be styled with the `panel.gotoLine` theme
/// selector.
export const gotoLine: Command = view => {
  let panel = getPanel(view, createLineDialog)
  if (!panel) {
    view.dispatch({
      reconfigure: view.state.field(dialogField, false) == null ? {append: [panels(), dialogField, baseTheme]} : undefined,
      effects: dialogEffect.of(true)
    })
    panel = getPanel(view, createLineDialog)
  }
  if (panel) panel.dom.querySelector("input")!.focus()
  return true
}

const baseTheme = EditorView.baseTheme({
  "$panel.gotoLine": {
    padding: "2px 6px 4px",
    "& label": { fontSize: "80%" }
  }
})

/// Keymap that binds Alt-g to [`gotoLine`](#goto-line.gotoLine).
export const gotoLineKeymap: readonly KeyBinding[] = [
  {key: "Alt-g", run: gotoLine}
]
