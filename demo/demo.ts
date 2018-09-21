import {EditorState, EditorSelection} from "../state/src"
import {EditorView} from "../view/src/"
import {keymap} from "../keymap/src/keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history/src/history"
import {gutter} from "../gutter/src/index"
import {baseKeymap} from "../commands/src/commands"
import {legacyMode} from "../legacy-modes/src/index"
import {matchBrackets} from "../matchbrackets/src/matchbrackets"
import javascript from "../legacy-modes/src/javascript"

let mode = legacyMode(javascript({indentUnit: 2}, {}))

// FIXME these should move to commands and access the indentation
// feature through some kind of generic mechanism that allows plugins
// to advertise that they can do indentation
function crudeInsertNewlineAndIndent({state, dispatch}: EditorView): boolean {
  let indentation = (mode as any).indentation(state, state.selection.primary.from)
  if (indentation > -1)
    dispatch(state.transaction.replaceSelection("\n" + " ".repeat(indentation)).scrollIntoView())
  return true
}
function crudeIndentLine({state, dispatch}: EditorView): boolean {
  let cursor = state.selection.primary.head // FIXME doesn't indent multiple lines
  let lineStart = state.doc.lineStartAt(cursor)
  let line = state.doc.slice(lineStart, cursor + 100)
  let space = /^ */.exec(line)[0].length // FIXME doesn't handle tabs
  let indentation = (mode as any).indentation(state, lineStart)
  if (indentation == -1) indentation = space
  let tr = state.transaction.replace(lineStart, lineStart + space, " ".repeat(indentation)).scrollIntoView()
  if (cursor <= lineStart + space)
    tr = tr.setSelection(EditorSelection.single(lineStart + indentation))
  dispatch(tr)
  return true
}

let isMac = /Mac/.test(navigator.platform)
let state = EditorState.create({doc: `"use strict";
const {readFile} = require("fs");

readFile("package.json", "utf8", (err, data) => {
  console.log(data);
});`, plugins: [matchBrackets(), gutter(), history(), mode, keymap(baseKeymap), keymap({
  "Mod-z": undo,
  "Mod-Shift-z": redo,
  "Mod-u": view => undoSelection(view) || true,
  [isMac ? "Mod-Shift-u" : "Alt-u"]: redoSelection,
  "Ctrl-y": isMac ? undefined : redo,
  "Enter": crudeInsertNewlineAndIndent,
  "Shift-Tab": crudeIndentLine
})]})

let view = (window as any).view = new EditorView(state)
document.querySelector("#editor").appendChild(view.dom)
