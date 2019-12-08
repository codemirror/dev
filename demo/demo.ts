import {EditorState} from "../state"
import {EditorView} from "../view"
import {keymap} from "../keymap"
import {history, redo, redoSelection, undo, undoSelection} from "../history"
//import {foldCode, unfoldCode, codeFolding, foldGutter} from "../fold"
//import {lineNumbers} from "../gutter"
import {baseKeymap, indentSelection} from "../commands"
//import {bracketMatching} from "../matchbrackets"
import {closeBrackets} from "../closebrackets"
//import {specialChars} from "../special-chars"
import {multipleSelections} from "../multiple-selections"
//import {search, defaultSearchKeymap} from "../search"
//import {autocomplete, sortAndFilterCompletion} from "../autocomplete"

//import {html} from "../lang-html"
//import {defaultHighlighter} from "../highlight"

//import {esLint, javascript} from "../lang-javascript"
// @ts-ignore
//import Linter from "eslint4b-prebuilt"
//import {linter} from "../lint"

let isMac = /Mac/.test(navigator.platform)
let state = EditorState.create({doc: `<script>
  const {readFile} = require("fs");

  readFile("package.json", "utf8", (err, data) => {
    console.log(data);
  });
</script>`, extensions: [
//  lineNumbers(),
  history(),
//  foldGutter(),
  multipleSelections(),
//  html(),
//  linter(esLint(new Linter)),
//  search({keymap: defaultSearchKeymap}),
//  defaultHighlighter,
//  bracketMatching(),
  closeBrackets,
/*  autocomplete({completeAt(state: EditorState, pos: number) {
    return new Promise(resolve => {
      let syntax = state.behavior(EditorState.syntax)[0]!
      let tree = syntax.getPartialTree(state, pos, pos).resolve(pos, -1)
      // FIXME nvda in einer VM ausprobieren
      let start = pos
      let items = [
        "a", "abbr", "address", "alu", "area", "article", "aside", "audio", "b",
        "base", "bdi", "bdo", "blockquote", "body", "br", "button", "canvas",
        "caption", "cite", "code", "col", "colgroup", "command", "data", "datalist",
        "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "embed", "fieldset",
        "figcaption", "figure", "footer", "form", "fram", "h1", "h2", "h3", "h4",
        "h5", "h6", "head", "header", "hr", "html", "i", "iframe", "img", "input",
        "ins", "kbd", "keygen", "label", "las", "legend", "li", "link", "main",
        "map", "mark", "math", "menu", "meta", "meter", "nav", "noscript", "object",
        "ol", "optgroup", "option", "output", "p", "param", "pre", "progress", "q",
        "re", "rp", "rt", "ruby", "s", "samp", "script", "section", "select",
        "small", "source", "span", "strong", "style", "sub", "summary", "sup",
        "svg", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time",
        "title", "tr", "track", "u", "ul", "var", "video", "wbr", "yp"
      ].map(s => ({label: s, insertText: s + ">"}))
      // FIXME for StartCloseTag, only suggest open tags
      if (tree.name == "StartTag" || tree.name == "StartCloseTag") return resolve({start, items})
      // FIXME also "Text" if previous sibling is StartCloseTag
      if (tree.name != "TagName" && tree.name != "MismatchedTagName") return resolve({start, items: []})
      start = tree.start
      setTimeout(() => resolve({
        start,
        items: sortAndFilterCompletion(state.doc.slice(start, pos), items)
      }), 100)
    })
  }}),*/
  keymap({
    "Mod-z": undo,
    "Mod-Shift-z": redo,
    "Mod-u": view => undoSelection(view) || true,
    [isMac ? "Mod-Shift-u" : "Alt-u"]: redoSelection,
    "Ctrl-y": isMac ? undefined : redo,
    "Shift-Tab": indentSelection,
//    "Mod-Alt-[": foldCode,
//    "Mod-Alt-]": unfoldCode
  }),
  keymap(baseKeymap),
]})

let view = (window as any).view = new EditorView({state})
document.querySelector("#editor")!.appendChild(view.dom)
