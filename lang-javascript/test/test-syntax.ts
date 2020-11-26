import ist from "ist"
import {EditorState} from "@codemirror/next/state"
import {javascriptLanguage} from "@codemirror/next/lang-javascript"
import {Tree} from "lezer"

function s(doc: string) {
  return EditorState.create({doc, extensions: [javascriptLanguage.extension]})
}

function tr(state: EditorState) {
  return javascriptLanguage.ensureTree(state, state.doc.length, 1e9)!
}

describe("javascript syntax queries", () => {
  it("returns a tree", () => {
    let state = s("let state = s()"), tree = tr(state)
    ist(tree instanceof Tree)
    ist(tree.type.name, "Script")
    ist(tree.length, state.doc.length)
    let def = tree.resolve(6)
    ist(def.name, "VariableDefinition")
    ist(def.from, 4)
    ist(def.to, 9)
  })

  it("keeps the tree up to date through changes", () => {
    let state = s("if (2)\n  x")
    ist(tr(state).topNode.childAfter(0)!.name, "IfStatement")
    state = state.update({changes: {from: 0, to: 3, insert: "fac"}}).state
    ist(tr(state).topNode.childAfter(0)!.name, "ExpressionStatement")
  })

  it("reuses nodes when parsing big documents", () => {
    let state = s("'hello';\n" + "blah;\n".repeat(3000))
    let buf = (tr(state).resolve(2) as any).buffer
    state = state.update({changes: {from: 2000, to: 2020, insert: "xyz"}}).state
    ist((tr(state).resolve(2) as any).buffer, buf)
  })
})
