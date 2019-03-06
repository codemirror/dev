import {EditorState, EditorSelection} from "../state/src"
import {EditorView} from "../view/src/"
import {keymap} from "../keymap/src/keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history/src/history"
import {gutter, GutterMarker} from "../gutter/src/index"
import {baseKeymap, indentSelection} from "../commands/src/commands"
import {legacyMode} from "../legacy-modes/src/index"
import {matchBrackets} from "../matchbrackets/src/matchbrackets"
import javascript from "../legacy-modes/src/javascript"
import {specialChars} from "../special-chars/src/special-chars"
import {multipleSelections} from "../multiple-selections/src/multiple-selections"

let mode = legacyMode({mode: javascript({indentUnit: 2}, {}) as any})

class TestMarker extends GutterMarker<string> {
  toDOM() { return document.createTextNode(this.value) }
}

function markEmptyLines(view: EditorView) {
  let deco = []
  view.viewportLines(line => {
    if (line.from == line.to) deco.push(TestMarker.create(line.from, "»"))
  })
  return TestMarker.set(deco)
}

let isMac = /Mac/.test(navigator.platform)
let state = EditorState.create({doc: `"use strict";
const {readFile} = require("fs");

readFile("package.json", "utf8", (err, data) => {
  console.log(data);
});`, extensions: [
  gutter({class: "my-gutter", initialMarkers: markEmptyLines, updateMarkers: (_, update) => markEmptyLines(update.view)}),
  history(),
  specialChars(),
  multipleSelections(),
  mode,
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
