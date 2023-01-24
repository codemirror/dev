import {basicSetup, EditorView} from "codemirror"
import {markdown} from "@codemirror/lang-markdown"
import {placeholder} from "@codemirror/view"

;(window as any).view = new EditorView({
  doc: "",
  extensions: [basicSetup, markdown(), placeholder("Hello")],
  parent: document.body
})
