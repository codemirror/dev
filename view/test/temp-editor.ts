import {EditorView} from "@codemirror/next/view"
import {EditorState, Extension} from "@codemirror/next/state"

const workspace: HTMLElement = document.querySelector("#workspace")! as HTMLElement

let tempView: EditorView | null = null
let hide: any = null

export function tempEditor(doc = "", extensions: readonly Extension[] = [],
                           options: {scroll?: number, wrapping?: boolean} = {}): EditorView {
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  tempView = new EditorView({state: EditorState.create({doc, extensions})})
  if (options.scroll) {
    tempView.contentDOM.style.overflow = "auto"
    tempView.scrollDOM.style.height = options.scroll + "px"
  }
  if (options.wrapping) tempView.contentDOM.style.whiteSpace = "pre-wrap"
  workspace.appendChild(tempView.dom)
  if (options.scroll) tempView.scrollDOM.scrollTop = 0
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
