import {EditorState} from "../state"
import {EditorView} from "../view"
import {keymap} from "../keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history"
import {foldCode, unfoldCode, foldGutter} from "../fold"
import {lineNumbers} from "../gutter"
import {baseKeymap, indentSelection} from "../commands"
import {bracketMatching} from "../matchbrackets"
import {closeBrackets} from "../closebrackets"
import {specialChars} from "../special-chars"
import {multipleSelections} from "../multiple-selections"
import {search, defaultSearchKeymap} from "../search"
import {autocomplete, startCompletion} from "../autocomplete"

import {html} from "../lang-html"
import {defaultHighlighter} from "../highlight"

import {esLint} from "../lang-javascript"
// @ts-ignore
import Linter from "eslint4b-prebuilt"
import {linter, openLintPanel} from "../lint"

//import {StreamSyntax} from "../stream-syntax"
//import legacyJS from "../legacy-modes/src/javascript"

let isMac = /Mac/.test(navigator.platform)
let state = EditorState.create({doc: `<script>
  const {readFile} = require("fs");

  readFile("package.json", "utf8", (err, data) => {
    console.log(data);
  });
</script>`, extensions: [
  lineNumbers(),
  specialChars(),
  history(),
  foldGutter(),
  multipleSelections(),
//  new StreamSyntax(legacyJS()).extension,
  html(),
  linter(esLint(new Linter)),
  search({keymap: defaultSearchKeymap}),
  defaultHighlighter,
  bracketMatching(),
  closeBrackets,
  autocomplete(),
  keymap({
    "Mod-z": undo,
    "Mod-Shift-z": redo,
    "Mod-u": view => undoSelection(view) || true,
    [isMac ? "Mod-Shift-u" : "Alt-u"]: redoSelection,
    "Ctrl-y": isMac ? undefined : redo,
    "Shift-Tab": indentSelection,
    "Mod-Alt-[": foldCode,
    "Mod-Alt-]": unfoldCode,
    "Mod-Space": startCompletion,
    "Shift-Mod-m": openLintPanel
  }),
  keymap(baseKeymap),
]})

let view = (window as any).view = new EditorView({state})
document.querySelector("#editor")!.appendChild(view.dom)
