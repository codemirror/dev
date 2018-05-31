import {EditorView} from "../src/view"
import {EditorState} from "../../state/src/state"

const workspace = document.querySelector("#workspace")

let tempView = null

export function tempEditor(doc = "", props: any = {}) {
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  let state = EditorState.create({doc, plugins: props.plugins})
  tempView = new EditorView(state, props)
  workspace.appendChild(tempView.dom)
  return tempView
}
