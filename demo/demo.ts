import {EditorState, EditorSelection} from "../state/src"
import {EditorView} from "../view/src/"
import {keymap} from "../keymap/src/keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history/src/history"
import {lineNumbers} from "../gutter/src/index"
import {baseKeymap, indentSelection} from "../commands/src/commands"
import {matchBrackets} from "../matchbrackets/src/matchbrackets"
import {specialChars} from "../special-chars/src/special-chars"
import {multipleSelections} from "../multiple-selections/src/multiple-selections"

import {javascript} from "../javascript/src/javascript"
import {defaultTheme} from "../theme/src/theme"
import {highlight} from "../highlight/src/highlight"

let isMac = /Mac/.test(navigator.platform)
let state = EditorState.create({doc: `"use strict";
const {readFile} = require("fs");

readFile("package.json", "utf8", (err, data) => {
  console.log(data);
});`, extensions: [
  lineNumbers(),
  history(),
  specialChars(),
  multipleSelections(),
  javascript(),
  defaultTheme,
  highlight(),
  matchBrackets(),
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
