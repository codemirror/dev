import ist from "ist"
import {EditorState} from "@codemirror/next/state"
import {javascriptSyntax} from "@codemirror/next/lang-javascript"
import {Tree} from "lezer"

function s(doc: string) {
  return EditorState.create({doc, extensions: [javascriptSyntax.extension]})
}

function tr(state: EditorState) {
  return javascriptSyntax.ensureTree(state, state.doc.length, 1e9)!
}

describe("javascript syntax queries", () => {
  it("returns a tree", () => {
    let state = s("let state = s()"), tree = tr(state)
    ist(tree instanceof Tree)
    ist(tree.name, "Script")
    ist(tree.length, state.doc.length)
    let def = tree.resolve(6)
    ist(def.name, "VariableDefinition")
    ist(def.start, 4)
    ist(def.end, 9)
  })

  it("keeps the tree up to date through changes", () => {
    let state = s("if (2)\n  x")
    ist(tr(state).childAfter(0)!.name, "IfStatement")
    state = state.t().replace(0, 3, "fac").apply()
    ist(tr(state).childAfter(0)!.name, "ExpressionStatement")
  })

  it("reuses nodes when parsing big documents", () => {
    let state = s("'hello';\n" + "blah;\n".repeat(3000))
    let buf = (tr(state).resolve(2) as any).buffer
    state = state.t().replace(2000, 2020, "xyz").apply()
    ist((tr(state).resolve(2) as any).buffer, buf)
  })
})
