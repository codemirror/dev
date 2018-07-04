import {EditorState, EditorSelection} from "../../state/src"
import {EditorView} from "../../view/src/"
import {keymap} from "../../keymap/src/keymap"
import {history, redo, undo} from "../../history/src/history"

let state = EditorState.create({doc: "one\nاِثْنَانِ\nthree\n".repeat(100), plugins: [history(), keymap({
  "ctrl-z": undo,
  "ctrl-shift-z": redo
})]})
let view = (window as any).view = new EditorView(state)
document.body.appendChild(view.dom)
;(window as any).tests = {
  getSelection() { return view.state.selection },
  setCursor(n: number) { view.dispatch(view.state.transaction.setSelection(EditorSelection.single(n)).scrollIntoView()) },
  setText(text: string) { view.dispatch(view.state.transaction.replace(0, view.state.doc.length, text)) },
  getText() { return view.state.doc.toString() }
}
