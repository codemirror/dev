import {EditorState, EditorView, basicSetup} from "@codemirror/next/basic-setup"
import {html} from "@codemirror/next/lang-html"

//import {esLint} from "@codemirror/next/lang-javascript"
// @ts-ignore
//import Linter from "eslint4b-prebuilt"
//import {linter} from "@codemirror/next/lint"

//import {StreamLanguage} from "@codemirror/next/stream-parser"
//import legacyJS from "@codemirror/next/legacy-modes/src/javascript"

let state = EditorState.create({doc: `<script>
  const {readFile} = require("fs");
  readFile("package.json", "utf8", (err, data) => {
    console.log(data);
  });
</script>
`, extensions: [
  basicSetup,
  html()
//  linter(esLint(new Linter)),
//  StreamLanguage.define(legacyJS()),
]})

;(window as any).view = new EditorView({state, parent: document.querySelector("#editor")!})
