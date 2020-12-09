import {EditorState, EditorSelection, StateCommand} from "@codemirror/next/state"
import {markdownLanguage, deleteMarkupBackward, insertNewlineContinueMarkup} from "@codemirror/next/lang-markdown"
import ist from "ist"

function mkState(doc: string) {
  let cursors = []
  for (let pos = 0;;) {
    pos = doc.indexOf("|", pos)
    if (pos < 0) break
    cursors.push(EditorSelection.cursor(pos))
    doc = doc.slice(0, pos) + doc.slice(pos + 1)
  }
  return EditorState.create({
    doc,
    selection: cursors.length ? EditorSelection.create(cursors) : undefined,
    extensions: [markdownLanguage, EditorState.allowMultipleSelections.of(true)]
  })
}

function stateStr(state: EditorState) {
  let doc = state.doc.toString()
  for (let i = state.selection.ranges.length - 1; i >= 0; i--) {
    let range = state.selection.ranges[i]
    doc = doc.slice(0, range.from) + "|" + doc.slice(range.to)
  }
  return doc
}

function cmd(state: EditorState, command: StateCommand) {
  command({state, dispatch(tr) { state = tr.state }})
  return state
}

describe("insertNewlineContinueMarkup", () => {
  function test(from: string, to: string) { ist(stateStr(cmd(mkState(from), insertNewlineContinueMarkup)), to) }

  it("doesn't continue anything at the top level", () =>
    test("one|", "one\n|"))

  it("doesn't do anything in non-Markdown content", () =>
    test("<div>|", "<div>|"))

  it("can continue blockquotes", () =>
    test("> one|", "> one\n> |"))

  it("can continue nested blockquotes", () =>
    test("> > one|", "> > one\n> > |"))

  it("preserves the absence of a blockquote space", () =>
    test(">>one|", ">>one\n>>|"))

  it("can continue bullet lists with dashes", () =>
    test(" - one|", " - one\n - |"))

  it("can continue bullet lists with asterisks", () =>
    test(" *  one|", " *  one\n *  |"))

  it("can continue bullet lists with plus signs", () =>
    test("+ one|", "+ one\n+ |"))

  it("can continue ordered lists with dots", () =>
    test(" 1. one|", " 1. one\n 2. |"))

  it("can continue ordered lists with parens", () =>
    test("2)  one|", "2)  one\n3)  |"))

  it("can continue lists inside blockquotes", () =>
    test("> - one|", "> - one\n> - |"))

  it("can continue markup for multiple cursors", () =>
    test("> one|\n\n- two|", "> one\n> |\n\n- two\n- |"))

  it("can continue nested lists", () =>
    test(" - one\n    1. two|", " - one\n    1. two\n    2. |"))

  it("will leave space before nested blockquotes", () =>
    test(" - one\n   > quoted|", " - one\n   > quoted\n   > |"))

  it("can drop trailing space when pressing enter in a blockquote", () =>
    test(">  |", ">\n> |"))

  it("can drop list markup when pressing enter directly after it", () =>
    test(" - one\n - |", " - one\n\n - |"))

  it("can drop list markup even with text after it", () =>
    test(" - one\n - |two", " - one\n\n - |two"))

  it("deletes the first list marker", () =>
    test(" - |", "\n|"))

  it("will keep the current ordered list number when moving a marker", () =>
    test(" 1. one\n 2. |", " 1. one\n\n 2. |"))

  it("can move list markup inside a blockquote", () =>
    test("> 1. one\n> 2. |", "> 1. one\n>\n> 2. |"))

  it("renumbers following ordered list items", () =>
    test("1. one|\n2. two", "1. one\n2. |\n3. two"))

  it("stops renumbering on discontinuities", () =>
    test("1. one|\n2. two\n3. three\n1. four", "1. one\n2. |\n3. two\n4. three\n1. four"))
})

describe("deleteMarkupBackward", () => {
  function test(from: string, to: string) { ist(stateStr(cmd(mkState(from), deleteMarkupBackward)), to) }

  it("does nothing in regular text", () =>
     test("one|", "one|"))

  it("does nothing at the top level", () =>
     test("one\n|", "one\n|"))

  it("can delete blockquote markers", () =>
     test("> |", "|"))

  it("only deletes one marker at a time", () =>
     test("> > |", "> |"))

  it("deletes trailing whitespace", () =>
     test(">   |", "> |"))

  it("clears list markers", () =>
     test(" - one\n - |", " - one\n   |"))

  it("deletes the first list marker immediately", () =>
    test(" - |", "|"))

  it("deletes nested list markers", () =>
    test(" > - |", " > |"))

  it("can delete for multiple cursors", () =>
    test("> |\n> |\n> |", "|\n|\n|"))
})
