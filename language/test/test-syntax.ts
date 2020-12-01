import ist from "ist"
import {__test, getIndentUnit, indentString, indentUnit} from "@codemirror/next/language"
import {EditorState, ChangeSet, Text} from "@codemirror/next/state"
import {parser} from "lezer-javascript"
import {Tree} from "lezer-tree"

const {ParseState} = __test

let lines = `const {readFile} = require("fs");
readFile("package.json", "utf8", (err, data) => {
  console.log(data);
});
`.split("\n")
for (let l0 = lines.length, i = l0; i < 5000; i++) lines[i] = lines[i % l0]
let doc = Text.of(lines)

function pState(doc: Text) {
  return new ParseState(parser, EditorState.create({doc}), [], Tree.empty)
}

describe("ParseState", () => {
  it("can parse a document", () => {
    let state = pState(Text.of(["let x = 10"]))
    state.work(1e8)
    ist(state.tree.toString(), "Script(VariableDeclaration(let,VariableDefinition,Equals,Number))")
  })

  it("can parse incrementally", () => {
    let state = pState(doc), t0 = Date.now()
    if (state.work(10)) {
      console.warn("Machine too fast for the incremental parsing test, skipping")
      return
    }
    ist(Date.now() - t0, 15, "<")
    ist(state.work(1e8))
    ist(state.tree.length, doc.length)
    let change = ChangeSet.of({from: 0, to: 5, insert: "let"}, doc.length)
    let newDoc = change.apply(doc)
    state = state.changes(change, EditorState.create({doc: newDoc}))
    ist(state.work(50))
    ist(state.tree.length, newDoc.length)
    ist(state.tree.toString().slice(0, 31), "Script(VariableDeclaration(let,")
  })
})

describe("indentation", () => {
  it("tracks indent units", () => {
    let s0 = EditorState.create({})
    ist(getIndentUnit(s0), 2)
    ist(indentString(s0, 4), "    ")
    let s1 = EditorState.create({extensions: indentUnit.of("   ")})
    ist(getIndentUnit(s1), 3)
    ist(indentString(s1, 4), "    ")
    let s2 = EditorState.create({extensions: [indentUnit.of("\t"), EditorState.tabSize.of(8)]})
    ist(getIndentUnit(s2), 8)
    ist(indentString(s2, 16), "\t\t")
  })
})
