import {EditorState, EditorSelection, SelectionRange, StateCommand} from "@codemirror/next/state"
import {indentMore, indentLess} from "@codemirror/next/commands"
import ist from "ist"

function mkState(doc: string) {
  let range = /\||<([^]*?)>/g, m
  let ranges = []
  while (m = range.exec(doc)) {
    if (m[1]) {
      ranges.push(new SelectionRange(m.index, m.index + m[1].length))
      doc = doc.slice(0, m.index) + doc.slice(m.index + 1, m.index + 1 + m[1].length) + doc.slice(m.index + m[0].length)
      range.lastIndex -= 2
    } else {
      ranges.push(new SelectionRange(m.index))
      doc = doc.slice(0, m.index) + doc.slice(m.index + 1)
      range.lastIndex--
    }
  }
  return EditorState.create({
    doc,
    selection: ranges.length ? EditorSelection.create(ranges) : undefined,
    extensions: EditorState.allowMultipleSelections.of(true)
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
})
