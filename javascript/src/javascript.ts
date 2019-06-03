import {TagMap} from "lezer"
import parser from "lezer-javascript"
import {StateExtension} from "../../state/src/"
import {LezerSyntax} from "../../syntax/src/syntax"
import {tokenTypes} from "../../highlight/src/highlight"
import {syntaxIndentation, dontIndent, parens, braces, brackets, statement, compositeStatement} from "../../indent/src/indent"

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

const indentStrategies = new TagMap(parser, {
  ExportDeclaration: statement,
  ClassDeclaration: statement,
  VariableDeclaration: statement, // FIXME force to 4?
  ImportDeclaration: statement,
  TryStatement: statement,
  ReturnStatement: statement,
  ThrowStatement: statement,
  BreakStatement: statement,
  ContinueStatement: statement,
  DebuggerStatement: statement,
  LabeledStatement: statement,
  ExpressionStatement: statement,

  // FIXME hanging statements
  ForStatement: statement,
  WhileStatement: statement,
  WithStatement: statement,
  DoWhileStatement: statement,
  IfStatement: compositeStatement(/^else\b/),

  ParamList: parens,
  ArgList: parens,
  ParenthesizedExpression: parens,
  ForSpec: parens,
  ForInSpec: parens,
  ForOfSpec: parens,

  ArrayPattern: brackets,
  ArrayExpression: brackets,

  ObjectPattern: braces,
  ObjectExpression: braces,
  ClassBody: braces,
  ExportGroup: braces,
  ImportGroup: braces,
  Block: braces,

  Template: dontIndent,

  // FIXME
  // "SwitchCase"
  // "SwitchDefault", "SwitchStatement"
  // "ConditionalExpression"
  BlockComment: dontIndent
})

export const javascriptSyntax = new LezerSyntax("javascript", parser, [tokenTypes(tokens)])

export function javascript() {
  return StateExtension.all(
    javascriptSyntax.extension,
    syntaxIndentation(javascriptSyntax, indentStrategies)
  )
}
