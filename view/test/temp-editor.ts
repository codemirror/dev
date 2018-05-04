import {EditorView} from "../src/view"
import {EditorState, Configuration} from "../../state/src/state"
import {Text} from "../../doc/src/text"

const workspace = document.querySelector("#workspace")

let tempView = null

export function tempEditor(doc = "", props = {}) {
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  let state = new EditorState(Configuration.default, typeof doc == "string" ? Text.create(doc) : doc)
  tempView = new EditorView(state, props)
  workspace.appendChild(tempView.dom)
  return tempView
}
