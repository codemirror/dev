import {EditorView} from "../src"
import {EditorState, Plugin} from "../../state/src/state"

const workspace = document.querySelector("#workspace")

let tempView = null

export function tempEditor(doc = "", plugins: Plugin[] = []) {
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  tempView = new EditorView(EditorState.create({doc, plugins}))
  workspace.appendChild(tempView.dom)
  return tempView
}

export function requireFocus() {
  if (!document.hasFocus())
    throw new Error("The document doesn't have focus, which is needed for this test (in Firefox, you may have to close the dev tools to get the stupid browser to leave focus on the document)")
}
