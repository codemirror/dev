import {EditorState} from "../state/src"
import {EditorView} from "../view/src/"
import {keymap} from "../keymap/src/keymap"
import {history, redo, undo} from "../history/src/history"
import {gutter} from "../gutter/src/index"
import {baseKeymap} from "../commands/src/commands"
import {legacyMode} from "../legacy-modes/src/"
import javascript from "../legacy-modes/src/javascript"

let state = EditorState.create({doc: `"use strict";
const {readFile} = require("fs");

readFile("package.json", "utf8", (err, data) => {
  console.log(data);
});`, plugins: [gutter(), history(), legacyMode(javascript({}, {})), keymap(baseKeymap), keymap({
  "ctrl-z": undo,
  "ctrl-shift-z": redo
})]})
let view = (window as any).view = new EditorView(state)
document.querySelector("#editor").appendChild(view.dom)
