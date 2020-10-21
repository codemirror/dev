import {parser} from "lezer-javascript"
import {LezerSyntax, flatIndent, continuedIndent, indentNodeProp, foldNodeProp, delimitedIndent} from "@codemirror/next/syntax"
import {styleTags} from "@codemirror/next/highlight"
import {completeSnippets} from "@codemirror/next/autocomplete"
import {Extension} from "@codemirror/next/state"
import {snippets} from "./snippets"

/// A syntax provider based on the [Lezer JavaScript
/// parser](https://github.com/lezer-parser/javascript), extended with
/// highlighting and indentation information.
export const javascriptSyntax = LezerSyntax.define(parser.withProps(
  indentNodeProp.add({
    IfStatement: continuedIndent({except: /^\s*({|else\b)/}),
    TryStatement: continuedIndent({except: /^\s*({|catch|finally)\b/}),
    LabeledStatement: flatIndent,
    SwitchBody: context => {
      let after = context.textAfter, closed = /^\s*\}/.test(after), isCase = /^\s*(case|default)\b/.test(after)
      return context.baseIndent + (closed ? 0 : isCase ? 1 : 2) * context.unit
    },
    Block: delimitedIndent({closing: "}"}),
    "TemplateString BlockComment": () => -1,
    "Statement Property": continuedIndent({except: /^{/})
  }),
  foldNodeProp.add({
    "Block ClassBody SwitchBody EnumBody ObjectExpression ArrayExpression"(tree) {
      return {from: tree.from + 1, to: tree.to - 1}
    },
    BlockComment(tree) { return {from: tree.from + 2, to: tree.to - 2} }
  }),
  styleTags({
    "get set async static": "modifier",
    "for while do if else switch try catch finally return throw break continue default case": "keyword control",
    "in of await yield void typeof delete instanceof": "operatorKeyword",
    "export import let var const function class extends": "keyword definition",
    "with debugger from as new": "keyword",
    TemplateString: "string#2",
    Super: "atom",
    BooleanLiteral: "bool",
    this: "self",
    null: "null",
    Star: "modifier",
    VariableName: "variableName",
    VariableDefinition: "variableName definition",
    Label: "labelName",
    PropertyName: "propertyName",
    PropertyNameDefinition: "propertyName definition",
    UpdateOp: "updateOperator",
    LineComment: "lineComment",
    BlockComment: "blockComment",
    Number: "number",
    String: "string",
    ArithOp: "arithmeticOperator",
    LogicOp: "logicOperator",
    BitOp: "bitwiseOperator",
    CompareOp: "compareOperator",
    RegExp: "regexp",
    Equals: "operator definition",
    Spread: "punctuation",
    "Arrow :": "punctuation definition",
    "( )": "paren",
    "[ ]": "squareBracket",
    "{ }": "brace",
    ".": "derefOperator",
    ", ;": "separator",

    TypeName: "typeName",
    TypeDefinition: "typeName definition",
    "type enum interface implements namespace module declare": "keyword definition",
    "abstract global privacy readonly": "modifier",
    "is keyof unique infer": "operatorKeyword",

    JSXAttributeValue: "string",
    JSXText: "content",
    "JSXStartTag JSXStartCloseTag JSXSelfCloseEndTag JSXEndTag": "angleBracket",
    "JSXIdentifier JSXNameSpacedName": "typeName",
    "JSXAttribute/JSXIdentifier JSXAttribute/JSXNameSpacedName": "propertyName"
  })
), {
  languageData: {
    closeBrackets: {brackets: ["(", "[", "{", "'", '"', "`"]},
    commentTokens: {line: "//", block: {open: "/*", close: "*/"}},
    indentOnInput: /^\s*(?:case |default:|\{|\})$/
  }
})

/// Returns an extension that installs JavaScript support features
/// (completion of [snippets](#lang-javascript.snippets)).
export function javascriptSupport(): Extension {
  return javascriptSyntax.languageData.of({autocomplete: completeSnippets(snippets)})
}

/// Returns an extension that installs the JavaScript syntax and
/// support features.
export function javascript(config: {jsx?: boolean, typescript?: boolean} = {}): Extension {
  let dialect = (config.jsx ? ["jsx"] : []).concat(config.typescript ? ["ts"] : []).join(" ")
  return [dialect ? javascriptSyntax.withDialect(dialect) : javascriptSyntax, javascriptSupport()]
}
