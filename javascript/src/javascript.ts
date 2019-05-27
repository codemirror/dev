import {TagMap} from "lezer"
import parser from "lezer-javascript"
import {StateExtension} from "../../state/src/"
import {LezerSyntax} from "../../syntax/src/syntax"
import {tokenTypes} from "../../highlight/src/highlight"

const tokens = new TagMap(parser, {
  Definition: "variable.definition",
  PropertyName: "property",
  Template: "string.template",
  Variable: "variable",
  Operator: "operator",
  Label: "meta.label",
  BlockComment: "comment.block",
  LineComment: "comment.line",
  Keyword: "keyword",
  OperatorKeyword: "keyword.operator",
  String: "string.quoted",
  Number: "number",
  Boolean: "atom.boolean",
  This: "keyword.expression.this",
  Null: "atom.null",
  Super: "keyword.expression.super",
  "(": "punctuation.paren.open",
  ")": "punctuation.paren.close",
  "[": "punctuation.bracket.open",
  "]": "punctuation.bracket.close",
  "{": "punctuation.brace.open",
  "}": "punctuation.brace.close",
  ";": "punctuation.semicolon",
  "...": "punctuation.spread",
  ",": "punctuation.comma",
  ":": "punctuation.colon",
  ".": "punctuation.dot",
  "=>": "punctuation.arrow"
})

export const javascriptSyntax = new LezerSyntax("javascript", parser, [tokenTypes(tokens)])

export function javascript() {
  return StateExtension.all(
    javascriptSyntax.extension
    // ... indentation, etc
  )
}
