import {EditorState} from "@codemirror/next/state"
import {EditorView} from "@codemirror/next/view"
import {keymap} from "@codemirror/next/keymap"
import {history, historyKeymap} from "@codemirror/next/history"
import {foldGutter, foldKeymap} from "@codemirror/next/fold"
import {lineNumbers} from "@codemirror/next/gutter"
import {baseKeymap, indentSelection} from "@codemirror/next/commands"
import {bracketMatching} from "@codemirror/next/matchbrackets"
import {closeBrackets} from "@codemirror/next/closebrackets"
import {specialChars} from "@codemirror/next/special-chars"
import {multipleSelections} from "@codemirror/next/multiple-selections"
import {search, searchKeymap} from "@codemirror/next/search"
import {autocomplete, startCompletion} from "@codemirror/next/autocomplete"
import {commentKeymap} from "@codemirror/next/comment"
import {rectangularSelection} from "@codemirror/next/rectangular-selection"
import {openLineDialog, gotoLine} from "@codemirror/next/goto-line"

import {html} from "@codemirror/next/lang-html"
import {defaultHighlighter} from "@codemirror/next/highlight"

//import {StreamSyntax} from "@codemirror/next/stream-syntax"
//import legacyJS from "@codemirror/next/legacy-modes/src/javascript"

let state = EditorState.create({doc: `<script>
  const {readFile} = require("fs");
  readFile("package.json", "utf8", (err, data) => {
    console.log(data);
  });
</script>
`, extensions: [
  lineNumbers(),
  specialChars(),
  history(),
  foldGutter(),
  multipleSelections(),
//  new StreamSyntax(legacyJS()).extension,
  html(),
  search(),
  defaultHighlighter,
  bracketMatching(),
  closeBrackets,
  autocomplete(),
  rectangularSelection(),
  gotoLine(),
  keymap([
    ...baseKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...commentKeymap,
    // FIXME move into exported keymaps
    {key: "Alt-g", run: openLineDialog},
    {key: "Shift-Tab", run: indentSelection},
    {key: "Mod-Space", run: startCompletion}
  ])
]})

let view = (window as any).view = new EditorView({state})
document.querySelector("#editor")!.appendChild(view.dom)
