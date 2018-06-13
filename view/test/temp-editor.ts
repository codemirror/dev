import {EditorView} from "../src/view"
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
