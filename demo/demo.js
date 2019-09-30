const {EditorState, EditorSelection} = require("../state")
const {EditorView} = require("../view")
const {keymap} = require("../keymap")
const {history, redo, redoSelection, undo, undoSelection} = require("../history")
const {lineNumbers} = require("../gutter")
const {baseKeymap, indentSelection} = require("../commands")
const {bracketMatching} = require("../matchbrackets")
const {specialChars} = require("../special-chars")
const {multipleSelections} = require("../multiple-selections")
const {syntaxIndentation} = require("../syntax")

const {html} = require("../lang-html")
const {defaultTheme, highlight} = require("../theme")

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

let view = window.view = new EditorView({state})
document.querySelector("#editor").appendChild(view.dom)
