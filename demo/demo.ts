import {EditorView, basicSetup} from "codemirror"
import {javascript} from "@codemirror/lang-javascript"

;(window as any).view = new EditorView({
  doc: 'console.log("Hello world")',
  extensions: [
    basicSetup,
    javascript(),
  ],
  parent: document.body
})
