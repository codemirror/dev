import {EditorState, EditorSelection} from "../state/src"
import {EditorView} from "../view/src/"
import {keymap} from "../keymap/src/keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history/src/history"
import {lineNumbers} from "../gutter/src/index"
import {baseKeymap, indentSelection} from "../commands/src/commands"
import {legacyMode} from "../legacy-modes/src/index"
import {matchBrackets} from "../matchbrackets/src/matchbrackets"
//import javascript from "../legacy-modes/src/javascript"
import {specialChars} from "../special-chars/src/special-chars"
import {multipleSelections} from "../multiple-selections/src/multiple-selections"

import {httpSyntax} from "./http"
import {javascript} from "../javascript/src/javascript"
import {defaultTheme} from "../theme/src/theme"
import {highlight} from "../highlight/src/highlight"

//let mode = legacyMode({mode: javascript({indentUnit: 2}, {}) as any})

let isMac = /Mac/.test(navigator.platform)
let state = EditorState.create({doc: `GET /hello.html HTTP/1.1
User-Agent: Mozilla/4.0 (compatible; MSIE5.01; Windows NT)
Accept-Language: en-us
Accept-Encoding: gzip, deflate

The body`, extensions: [
  lineNumbers(),
  history(),
  specialChars(),
  multipleSelections(),
  httpSyntax(),
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
