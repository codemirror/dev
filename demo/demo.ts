import {EditorState, EditorView, basicSetup} from "@codemirror/basic-setup"
import {html} from "@codemirror/lang-html"
import {oneDark} from "@codemirror/theme-one-dark"

//import {esLint} from "@codemirror/lang-javascript"
// @ts-ignore
//import Linter from "eslint4b-prebuilt"
//import {linter} from "@codemirror/lint"

//import {StreamLanguage} from "@codemirror/stream-parser"
//import {javascript} from "@codemirror/legacy-modes/mode/javascript"

let state = EditorState.create({doc: `<script>
  const {readFile} = require("fs");
  readFile("package.json", "utf8", (err, data) => {
    console.log(data);
  });
</script>
`, extensions: [
  basicSetup,
  html(),
  oneDark
//  linter(esLint(new Linter)),
//  StreamLanguage.define(javascript),
]})

;(window as any).view = new EditorView({state, parent: document.querySelector("#editor")!})
