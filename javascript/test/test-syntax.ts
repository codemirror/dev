const ist = require("ist")
import {EditorState} from "../../state/src"
import {javascriptSyntax} from "../src/javascript"
import {Tree} from "lezer"

function s(doc: string) {
  return EditorState.create({doc, extensions: [javascriptSyntax.extension]})
}

function tr(state: EditorState) {
  return javascriptSyntax.tryGetTree(state, 0, state.doc.length)
}

describe("javascript syntax queries", () => {
  it("returns a tree", () => {
    let state = s("let state = s()"), tree = tr(state)
    ist(tree instanceof Tree)
    ist(tree.tag.tag, "script.document.lang=javascript")
    ist(tree.length, state.doc.length)
    let def = tree.resolve(6)
    ist(def.tag.tag.startsWith("definition.variable.name"))
    ist(def.start, 4)
    ist(def.end, 9)
  })

  it("keeps the tree up to date through changes", () => {
    let state = s("if (2)\n  x")
    ist(tr(state).childAfter(0)!.tag.tag.startsWith("if.conditional.statement"))
    state = state.t().replace(0, 3, "fac").apply()
    ist(tr(state).childAfter(0)!.tag.tag.startsWith("expression.statement"))
  })

  it("reuses nodes when parsing big documents", () => {
    let state = s("'hello';\n" + "blah;\n".repeat(3000))
    let buf = (tr(state).resolve(2) as any).buffer
    state = state.t().replace(2000, 2020, "xyz").apply()
    ist((tr(state).resolve(2) as any).buffer, buf)
  })
})
