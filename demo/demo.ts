import {EditorState, EditorView, basicSetup} from "@codemirror/basic-setup"
import {javascript} from "@codemirror/lang-javascript"

let state = EditorState.create({doc: 'console.log("Hello world")', extensions: [
  basicSetup,
  javascript(),
]})

;(window as any).view = new EditorView({state, parent: document.querySelector("#editor")!})
