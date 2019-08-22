import {EditorState, EditorSelection} from "../state/src"
import {EditorView} from "../view/src/"
import {keymap} from "../keymap/src/keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history/src/history"
import {lineNumbers} from "../gutter/src/index"
import {baseKeymap, indentSelection} from "../commands/src/commands"
import {bracketMatching} from "../matchbrackets/src/matchbrackets"
import {specialChars} from "../special-chars/src/special-chars"
import {multipleSelections} from "../multiple-selections/src/multiple-selections"
import {syntaxIndentation} from "../lezer-syntax/src"

import {html} from "../html/src/html"
import {defaultTheme, highlight} from "../theme/src/"

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
  syntaxIndentation,
  defaultTheme,
  highlight(),
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
document.querySelector("#editor").appendChild(view.dom)
