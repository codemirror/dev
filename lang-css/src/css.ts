import {parser} from "lezer-css"
import {Subtree} from "lezer-tree"
import {LezerSyntax, continuedIndent, indentNodeProp, foldNodeProp} from "@codemirror/next/syntax"
import {styleTags} from "@codemirror/next/highlight"
import {Extension} from "@codemirror/next/state"

/// A syntax provider based on the [Lezer CSS
/// parser](https://github.com/lezer-parser/css), extended with
/// highlighting and indentation information.
export const cssSyntax = LezerSyntax.define(parser.withProps(
  indentNodeProp.add({
    Declaration: continuedIndent()
  }),
  foldNodeProp.add({
    Block(subtree: Subtree) { return {from: subtree.start + 1, to: subtree.end - 1} }
  }),
  styleTags({
    "import charset namespace keyframes": "keyword definition",
    "media supports": "keyword control",
    "from to": "keyword",
    NamespaceName: "namespace",
    KeyframeName: "labelName",
    TagName: "typeName",
    ClassName: "className",
    PseudoClassName: "className constant",
    not: "operatorKeyword",
    IdName: "labelName",
    AttributeName: "propertyName",
    NumberLiteral: "number",
    PropertyName: "propertyName",
    KeywordQuery: "keyword",
    FeatureName: "propertyName",
    UnaryQueryOp: "operatorKeyword",
    callee: "keyword",
    ValueName: "atom",
    CallTag: "atom",
    Callee: "variableName",
    Unit: "unit",
    "UniversalSelector NestingSelector": "operator definition",
    AtKeyword: "keyword",
    MatchOp: "compareOperator",
    "ChildOp SiblingOp, LogicOp": "logicOperator",
    BinOp: "arithmeticOperator",
    Important: "modifier",
    Comment: "blockComment",
    ParenthesizedContent: "name#2",
    ColorLiteral: "color",
    StringLiteral: "string",
    ":": "punctuation definition",
    "PseudoOp #": "derefOperator",
    "; ,": "separator",
    "( )": "paren",
    "[ ]": "squareBracket",
    "{ }": "brace"
  })
), {
  languageData: {
    commentTokens: {block: {open: "/*", close: "*/"}}
  }
})

/// Returns an extension that installs the CSS syntax provider.
export function css(): Extension {
  return cssSyntax
}
