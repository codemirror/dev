import {EditorState} from "@codemirror/next/state"
import {EditorView} from "@codemirror/next/view"
import {keymap} from "@codemirror/next/keymap"
import {history, redo, redoSelection, undo, undoSelection} from "@codemirror/next/history"
import {foldCode, unfoldCode, foldGutter} from "@codemirror/next/fold"
import {lineNumbers} from "@codemirror/next/gutter"
import {baseKeymap, indentSelection} from "@codemirror/next/commands"
import {bracketMatching} from "@codemirror/next/matchbrackets"
import {closeBrackets} from "@codemirror/next/closebrackets"
import {specialChars} from "@codemirror/next/special-chars"
import {multipleSelections} from "@codemirror/next/multiple-selections"
import {search, defaultSearchKeymap} from "@codemirror/next/search"
import {autocomplete, startCompletion} from "@codemirror/next/autocomplete"

import {html} from "@codemirror/next/lang-html"
import {defaultHighlighter} from "@codemirror/next/highlight"

import {esLint} from "@codemirror/next/lang-javascript"
// @ts-ignore
import Linter from "eslint4b-prebuilt"
import {linter, openLintPanel} from "@codemirror/next/lint"

//import {StreamSyntax} from "@codemirror/next/stream-syntax"
//import legacyJS from "@codemirror/next/legacy-modes/src/javascript"

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


// let tr = state.t().replace(6, 11, "from transaction")
// console.log(tr.doc.toString()) // "hello editor"
// let newState = transaction.apply()
// view.dispatch(tr)

enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

const toggleComment = function(option: CommentOption = CommentOption.Toggle) {
  const lineCommentToken = "//"
  let s = view.state
  let f = s.selection.primary.from
  let t = s.selection.primary.to
  let l = s.doc.lineAt(f)
  console.log(f, t, l.start)
  let str = (l.content as string)
  if (str.startsWith(lineCommentToken)) {
    if (option != CommentOption.OnlyComment) {
      let tr = view.state.t().replace(l.start, l.start + lineCommentToken.length, "")
      view.dispatch(tr)
    }

  } else {
    if (option != CommentOption.OnlyUncomment) {
      let tr = view.state.t().replace(l.start, l.start, lineCommentToken)
      view.dispatch(tr)
    }
  }
}

const comment = function() {
  toggleComment(CommentOption.OnlyComment)
}

const uncomment = function() {
  toggleComment(CommentOption.OnlyUncomment)
}

document.querySelector("#toggleComment")!.addEventListener("click", function() {
  toggleComment()
});

document.querySelector("#comment")!.addEventListener("click", function() {
  comment()
});

document.querySelector("#uncomment")!.addEventListener("click", function() {
  uncomment()
});
