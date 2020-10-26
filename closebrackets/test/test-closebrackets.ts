import ist from "ist"
import {handleInsertion, deleteBracketPair, closeBrackets} from "@codemirror/next/closebrackets"
import {EditorState, EditorSelection, StateCommand} from "@codemirror/next/state"
import {StreamSyntax} from "@codemirror/next/stream-syntax"

function s(doc = "", anchor = 0, head = anchor) {
  return EditorState.create({doc, selection: EditorSelection.single(anchor, head), extensions: closeBrackets()})
}

function same(s: EditorState, s1: EditorState) {
  ist(s.doc.toString(), s1.doc.toString())
  ist(JSON.stringify(s.selection), JSON.stringify(s1.selection))
}

function app(s: EditorState, cmd: StateCommand) {
  cmd({state: s, dispatch: (tr) => s = tr.state})
  return s
}

function canApp(s: EditorState, cmd: StateCommand) {
  return !!cmd({state: s, dispatch: () => {}})
}

function ins(s: EditorState, value: string) {
  let result = handleInsertion(s, value)
  return result ? result.state : s
}

function type(s: EditorState, text: string) {
  return s.update(s.replaceSelection(text)).state
}

describe("closeBrackets", () => {
  it("closes brackets", () => {
    same(ins(s(), "("), s("()", 1))
    same(ins(s("foo", 3), "["), s("foo[]", 4))
    same(ins(s(), "{"), s("{}", 1))
  })

  it("closes brackets before whitespace", () => {
    same(ins(s("foo bar", 3), "("), s("foo() bar", 4))
    same(ins(s("\t"), "{"), s("{}\t", 1))
  })

  it("doesn't close brackets before regular chars", () => {
    ist(!handleInsertion(s("foo bar", 4), "("))
    ist(!handleInsertion(s("foo bar", 5), "["))
    ist(!handleInsertion(s("*"), "{"))
  })

  it("closes brackets before allowed chars", () => {
    same(ins(s("foo }", 4), "("), s("foo ()}", 5))
    same(ins(s("foo :", 4), "["), s("foo []:", 5))
  })

  it("surrounds selected content", () => {
    same(ins(s("onetwothree", 3, 6), "("), s("one(two)three", 4, 7))
    same(ins(s("okay", 4, 0), "["), s("[okay]", 5, 1))
  })

  it("skips matching close brackets", () => {
    same(ins(ins(s("foo", 3), "("), ")"), s("foo()", 5))
    same(ins(ins(s("", 0), "["), "]"), s("[]", 2))
  })

  it("doesn't skip when there's a selection", () => {
    same(ins(ins(s("a", 0, 1), "("), ")"), s("(a)", 1, 2))
  })

  it("doesn't skip when the next char doesn't match", () => {
    ist(!handleInsertion(s("(a)", 1, 2), "]"))
  })

  it("closes quotes", () => {
    same(ins(s(), "'"), s("''", 1))
    same(ins(s("foo ", 4), "\""), s("foo \"\"", 5))
  })

  it("wraps quotes around the selection", () => {
    same(ins(s("a b c", 2, 3), "'"), s("a 'b' c", 3, 4))
    same(ins(s("boop", 3, 1), "'"), s("b'oo'p", 4, 2))
  })

  it("doesn't close quotes in words", () => {
    ist(!handleInsertion(s("ab", 1), "'"))
    ist(!handleInsertion(s("ab", 2), "'"))
    ist(!handleInsertion(s("ab", 0), "'"))
  })

  const syntax = new StreamSyntax({
    token(stream) {
      if (stream.match("'''")) {
        while (!stream.match("'''") && !stream.eol()) stream.next()
        return "string"
      } else if (stream.match("'")) {
        while (!stream.match("'") && !stream.eol()) stream.next()
        return "string"
      } else {
        stream.next()
        return ""
      }
    }
  })
  const data = syntax.languageData.of({closeBrackets: {brackets: ["(", "'", "'''"]}})

  function st(doc = "", anchor = 0, head = anchor) {
    return EditorState.create({doc, selection: EditorSelection.single(anchor, head), extensions: [syntax, data, closeBrackets()]})
  }

  it("skips closing quotes", () => {
    same(ins(type(ins(s(), "'"), "foo"), "'"), st("'foo'", 5))
  })

  it("closes triple-quotes", () => {
    same(ins(st("''", 2), "'"), st("''''''", 3))
  })

  it("skips closing triple-quotes", () => {
    same(ins(ins(st("''", 2), "'"), "'"), st("''''''", 6))
  })

  it("closes quotes before another string", () => {
    same(ins(st("foo ''", 4), "'"), st("foo ''''", 5))
  })

  it("backspaces out pairs of brackets", () => {
    same(app(st("()", 1), deleteBracketPair), st(""))
    same(app(st("okay ''", 6), deleteBracketPair), st("okay ", 5))
  })

  it("doesn't backspace out non-brackets", () => {
    ist(!canApp(st("(]", 1), deleteBracketPair))
    ist(!canApp(st("(", 1), deleteBracketPair))
    ist(!canApp(st("-]", 1), deleteBracketPair))
    ist(!canApp(st("", 0), deleteBracketPair))
  })

  it("doesn't skip brackets not inserted by the addon", () => {
    same(ins(s("()", 1), ")"), s("()", 1))
  })

  it("can remember multiple brackets", () => {
    same(ins(ins(type(ins(type(ins(s(), "("), "foo"), "["), "x"), "]"), ")"), s("(foo[x])", 8))
  })

  it("clears state when moving to a different line", () => {
    let state = ins(s("one\ntwo", 7), "(")
    state = state.update({selection: {anchor: 0}}).state
    state = state.update({selection: {anchor: 8}}).state
    ist(!handleInsertion(state, ")"))
  })

  it("doesn't clear state for changes on different lines", () => {
    let state = ins(s("one\ntwo", 7), "(")
    state = state.update({changes: {insert: "x", from: 0}}).state
    same(ins(state, ")"), s("xone\ntwo()", 10))
  })
})
