const ist = require("ist")
import {EditorState, StateExtension} from "../../state/src"
import {javascript} from "../src/javascript"

function getIndent(state: EditorState, pos: number): number {
  for (let f of state.behavior.get(StateExtension.indentation)) {
    let result = f(state, pos)
    if (result > -1) return result
  }
  return -1
}

function check(code: string) {
  code = /^\n*([^]*)/.exec(code)![1]
  let state = EditorState.create({doc: code, extensions: [javascript()]})
  for (let pos = 0, lines = code.split("\n"), i = 0; i < lines.length; i++) {
    let line = lines[i], indent = /^\s*/.exec(line)![0].length
    ist(`${getIndent(state, pos)} (${i + 1})`, `${indent} (${i + 1})`)
    pos += line.length + 1
  }
}

describe("javascript indentation", () => {
  it("indents argument blocks", () => check(`
foo({
  bar,
  baz
})
`))

  it("indents function args", () => check(`
foo(
  bar
)`))

  it("indents nested calls", () => check(`
one(
  two(
    three(
      four()
    )
  )
)`))

})
