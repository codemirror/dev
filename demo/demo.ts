import {EditorState, EditorView, basicSetup} from "@codemirror/basic-setup"
import {markdown} from "@codemirror/lang-markdown"
import {oneDark} from "@codemirror/theme-one-dark"

let state = EditorState.create({doc: '"one" "two"', extensions: [
  basicSetup,
  markdown(),
]})

let view = (window as any).view = new EditorView({state, parent: document.querySelector("#editor")!})
