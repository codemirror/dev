import {EditorState} from "../state"
import {EditorView} from "../view"
import {keymap} from "../keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history"
import {lineNumbers} from "../gutter"
import {baseKeymap, indentSelection} from "../commands"
import {bracketMatching} from "../matchbrackets"
import {specialChars} from "../special-chars"
import {multipleSelections} from "../multiple-selections"

import {html} from "../lang-html"
import {defaultHighlighter} from "../highlight"

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
  multipleSelections(),
  html(),
  defaultHighlighter,
  bracketMatching(),
  keymap({
    "Mod-z": undo,
    "Mod-Shift-z": redo,
    "Mod-u": view => undoSelection(view) || true,
    [isMac ? "Mod-Shift-u" : "Alt-u"]: redoSelection,
    "Ctrl-y": isMac ? undefined : redo,
    "Shift-Tab": indentSelection
  }),
  keymap(baseKeymap),
]})

let view = (window as any).view = new EditorView({state})
document.querySelector("#editor")!.appendChild(view.dom)
