import ist from "ist"
import {handleInsertion, handleBackspace} from "@codemirror/next/closebrackets"
import {EditorState, Transaction, EditorSelection, languageData} from "@codemirror/next/state"
import {Text} from "@codemirror/next/text"
import {StreamSyntax} from "@codemirror/next/stream-syntax"

function s(doc = "", anchor = 0, head = anchor) {
  return EditorState.create({doc, selection: EditorSelection.single(anchor, head)})
}

function same(s0: null | Transaction, s1: EditorState) {
  ist(s0)
  ist(s0!.apply().doc.toString(), s1.doc.toString())
  ist(JSON.stringify(s0!.selection), JSON.stringify(s1.selection))
}

describe("closeBrackets", () => {
  it("closes brackets", () => {
    same(handleInsertion(s(), "("), s("()", 1))
    same(handleInsertion(s("foo", 3), "["), s("foo[]", 4))
    same(handleInsertion(s(), "{"), s("{}", 1))
  })

  it("closes brackets before whitespace", () => {
    same(handleInsertion(s("foo bar", 3), "("), s("foo() bar", 4))
    same(handleInsertion(s("\t"), "{"), s("{}\t", 1))
  })

  it("doesn't close brackets before regular chars", () => {
    ist(!handleInsertion(s("foo bar", 4), "("))
    ist(!handleInsertion(s("foo bar", 5), "["))
    ist(!handleInsertion(s("*"), "{"))
  })

  it("closes brackets before allowed chars", () => {
    same(handleInsertion(s("foo }", 4), "("), s("foo ()}", 5))
    same(handleInsertion(s("foo :", 4), "["), s("foo []:", 5))
  })

  it("surrounds selected content", () => {
    same(handleInsertion(s("onetwothree", 3, 6), "("), s("one(two)three", 4, 7))
    same(handleInsertion(s("okay", 4, 0), "["), s("[okay]", 5, 1))
  })

  it("skips matching close brackets", () => {
    same(handleInsertion(s("foo()", 4), ")"), s("foo()", 5))
    same(handleInsertion(s("[]x", 1), "]"), s("[]x", 2))
  })

  it("doesn't skip when there's a selection", () => {
    ist(!handleInsertion(s("(a)", 1, 2), ")"))
  })

  it("doesn't skip when the next char doesn't match", () => {
    ist(!handleInsertion(s("(a)", 1, 2), "]"))
  })

  it("closes quotes", () => {
    same(handleInsertion(s(), "'"), s("''", 1))
    same(handleInsertion(s("foo ", 4), "\""), s("foo \"\"", 5))
  })

  it("wraps quotes around the selection", () => {
    same(handleInsertion(s("a b c", 2, 3), "'"), s("a 'b' c", 3, 4))
    same(handleInsertion(s("boop", 3, 1), "'"), s("b'oo'p", 4, 2))
  })

  it("doesn't close quotes in words", () => {
    ist(!handleInsertion(s("ab", 1), "'"))
    ist(!handleInsertion(s("ab", 2), "'"))
    ist(!handleInsertion(s("ab", 0), "'"))
  })

  const syntax = new StreamSyntax({
    docProps: [[languageData, {closeBrackets: {brackets: ["(", "'", "'''"]}}]],
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

  function st(doc = "", anchor = 0, head = anchor) {
    return EditorState.create({doc, selection: EditorSelection.single(anchor, head), extensions: [syntax.extension]})
  }

  it("skips closing quotes", () => {
    same(handleInsertion(st("'foo'", 4), "'"), st("'foo'", 5))
  })

  it("closes triple-quotes", () => {
    same(handleInsertion(st("''", 2), "'"), st("''''''", 3))
  })

  it("skips closing triple-quotes", () => {
    same(handleInsertion(st("''''''", 3), "'"), st("''''''", 6))
  })

  it("closes quotes before another string", () => {
    same(handleInsertion(st("foo ''", 4), "'"), st("foo ''''", 5))
  })

  it("backspaces out pairs of brackets", () => {
    same(handleBackspace(st("()", 1)), st(""))
    same(handleBackspace(st("okay ''", 6)), st("okay ", 5))
  })

  it("doesn't backspace out non-brackets", () => {
    ist(!handleBackspace(st("(]", 1)))
    ist(!handleBackspace(st("(", 1)))
    ist(!handleBackspace(st("-]", 1)))
    ist(!handleBackspace(st("", 0)))
  })
})
