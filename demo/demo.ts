import {EditorState} from "../state"
import {EditorView} from "../view"
import {keymap} from "../keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history"
import {foldCode, unfoldCode, codeFolding, foldGutter} from "../fold"
import {lineNumbers} from "../gutter"
import {baseKeymap, indentSelection} from "../commands"
import {bracketMatching} from "../matchbrackets"
import {closeBrackets} from "../closebrackets"
import {specialChars} from "../special-chars"
import {multipleSelections} from "../multiple-selections"
import {search, defaultSearchKeymap} from "../search"

import {html} from "../lang-html"
import {defaultHighlighter} from "../highlight"

import {esLint, javascript} from "../lang-javascript"
// @ts-ignore
import Linter from "eslint4b-prebuilt"
import {linter} from "../lint"

let isMac = /Mac/.test(navigator.platform)
let state = EditorState.create({doc: `<script>
  const {readFile} = require("fs");

  readFile("package.json", "utf8", (err, data) => {
    console.log(data);
  });
</script>`, extensions: [
  lineNumbers(),
  history(),
  specialChars(),
  foldGutter(),
  multipleSelections(),
  html(),
  linter(esLint(new Linter)),
  search({keymap: defaultSearchKeymap}),
  defaultHighlighter,
  bracketMatching(),
  closeBrackets,
  keymap({
    "Mod-z": undo,
    "Mod-Shift-z": redo,
    "Mod-u": view => undoSelection(view) || true,
    [isMac ? "Mod-Shift-u" : "Alt-u"]: redoSelection,
    "Ctrl-y": isMac ? undefined : redo,
    "Shift-Tab": indentSelection,
    "Mod-Alt-[": foldCode,
    "Mod-Alt-]": unfoldCode
  }),
  keymap(baseKeymap),
]})

let view = (window as any).view = new EditorView({state})
document.querySelector("#editor")!.appendChild(view.dom)
