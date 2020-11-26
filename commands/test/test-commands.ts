import {EditorState, EditorSelection, StateCommand, Extension} from "@codemirror/next/state"
import {indentMore, indentLess, indentSelection, insertNewlineAndIndent} from "@codemirror/next/commands"
import {javascriptLanguage} from "@codemirror/next/lang-javascript"
import ist from "ist"

function mkState(doc: string, extensions: Extension = []) {
  let range = /\||<([^]*?)>/g, m
  let ranges = []
  while (m = range.exec(doc)) {
    if (m[1]) {
      ranges.push(EditorSelection.range(m.index, m.index + m[1].length))
      doc = doc.slice(0, m.index) + doc.slice(m.index + 1, m.index + 1 + m[1].length) + doc.slice(m.index + m[0].length)
      range.lastIndex -= 2
    } else {
      ranges.push(EditorSelection.cursor(m.index))
      doc = doc.slice(0, m.index) + doc.slice(m.index + 1)
      range.lastIndex--
    }
  }
  return EditorState.create({
    doc,
    selection: ranges.length ? EditorSelection.create(ranges) : undefined,
    extensions: [extensions, EditorState.allowMultipleSelections.of(true)]
  })
}

function stateStr(state: EditorState) {
  let doc = state.doc.toString()
  for (let i = state.selection.ranges.length - 1; i >= 0; i--) {
    let range = state.selection.ranges[i]
    if (range.empty)
      doc = doc.slice(0, range.from) + "|" + doc.slice(range.from)
    else
      doc = doc.slice(0, range.from) + "<" + doc.slice(range.from, range.to) + ">" + doc.slice(range.to)
  }
  return doc
}

function cmd(state: EditorState, command: StateCommand) {
  command({state, dispatch(tr) { state = tr.state }})
  return state
}

describe("commands", () => {
  describe("indentMore", () => {
    function test(from: string, to: string) { ist(stateStr(cmd(mkState(from), indentMore)), to) }

    it("adds indentation", () =>
       test("one\ntwo|\nthree", "one\n  two|\nthree"))

    it("indents all lines in a range", () =>
       test("one\n<two\nthree>", "one\n  <two\n  three>"))

    it("doesn't double-indent a given line", () =>
       test("on|e|\n<two\nth><ree\nfour>", "  on|e|\n  <two\n  th><ree\n  four>"))
  })

  describe("indentLess", () => {
    function test(from: string, to: string) { ist(stateStr(cmd(mkState(from), indentLess)), to) }

    it("removes indentation", () =>
       test("one\n  two|\nthree", "one\ntwo|\nthree"))

    it("removes one unit of indentation", () =>
       test("one\n    two|\n     three|", "one\n  two|\n   three|"))

    it("dedents all lines in a range", () =>
       test("one\n  <two\n  three>", "one\n<two\nthree>"))

    it("takes tabs into account", () =>
       test("   \tone|\n  \ttwo|", "  one|\n  two|"))

    it("can split tabs", () =>
       test("\tone|", "  one|"))
  })

  describe("indentSelection", () => {
    function test(from: string, to: string) {
      ist(stateStr(cmd(mkState(from, javascriptLanguage), indentSelection)), to)
    }

    it("auto-indents the current line", () =>
       test("if (0)\nfoo()|", "if (0)\n  foo()|"))

    it("moves the cursor ahead of the indentation", () =>
       test("if (0)\n | foo()", "if (0)\n  |foo()"))

    it("indents blocks of lines", () =>
       test("if (0) {\n<one\ntwo\nthree>\n}", "if (0) {\n  <one\n  two\n  three>\n}"))

    it("includes previous indentation changes in relative indentation", () =>
       test("<{\n{\n{\n{}\n}\n}\n}>", "<{\n  {\n    {\n      {}\n    }\n  }\n}>"))
  })

  describe("insertNewlineAndIndent", () => {
    function test(from: string, to: string) {
      ist(stateStr(cmd(mkState(from, javascriptLanguage), insertNewlineAndIndent)), to)
    }

    it("indents the new line", () =>
       test("{|", "{\n  |"))

    it("can handle multiple selections", () =>
       test("{|\n  foo()|", "{\n  |\n  foo()\n  |"))

    it("isn't confused by text after the cursor", () =>
       test("{|two", "{\n  |two"))

    it("deletes selected text", () =>
       test("{<one>two", "{\n  |two"))

    it("can explode brackets", () =>
       test("let x = [|]", "let x = [\n  |\n]"))

    it("can explode in indented positions", () =>
       test("{\n  foo(|)", "{\n  foo(\n    |\n  )"))

    it("can explode brackets with whitespace", () =>
       test("foo( | )", "foo(\n  |\n)"))
  })
})
