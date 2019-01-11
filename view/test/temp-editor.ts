import {EditorView} from "../src"
import {EditorState, Plugin} from "../../state/src"

const workspace: HTMLElement = document.querySelector("#workspace")! as HTMLElement

let tempView: EditorView | null = null
let hide: any = null

export function tempEditor(doc = "", plugins: Plugin[] = []): EditorView {
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  tempView = new EditorView(EditorState.create({doc, plugins}))
  workspace.appendChild(tempView.dom)
  workspace.style.pointerEvents = ""
  if (hide == null) hide = setTimeout(() => {
    hide = null
    workspace.style.pointerEvents = "none"
  }, 100)
  return tempView
}

export function requireFocus(cm: EditorView): EditorView {
  if (!document.hasFocus())
    throw new Error("The document doesn't have focus, which is needed for this test")
  cm.focus()
  return cm
}
