import {parser} from "lezer-javascript"
import {flatIndent, continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {languageData} from "@codemirror/next/state"
import {Subtree} from "lezer-tree"
import {styleTags} from "@codemirror/next/highlight"

const statementIndent = continuedIndent({except: /^{/})

/// A syntax provider based on the [Lezer JavaScript
/// parser](https://github.com/lezer-parser/javascript), extended with
/// highlighting and indentation information.
export const javascriptSyntax = new LezerSyntax(parser.withProps(
  languageData.add({
    Script: {
      closeBrackets: {brackets: ["(", "[", "{", "'", '"', "`"]},
      commentTokens: {lineComment: "//", blockComment: {open: "/*", close: "*/"}},
    }
  }),
  indentNodeProp.add(type => {
    if (type.name == "IfStatement") return continuedIndent({except: /^({|else\b)/})
    if (type.name == "TryStatement") return continuedIndent({except: /^({|catch|finally)\b/})
    if (type.name == "LabeledStatement") return flatIndent
    if (type.name == "SwitchBody") return context => {
      let after = context.textAfter, closed = after[0] == "}", isCase = /^(case|default)\b/.test(after)
      return context.baseIndent + (closed ? 0 : isCase ? 1 : 2) * context.unit
    }
    if (type.name == "TemplateString" || type.name == "BlockComment") return () => -1
    if (/(Statement|Declaration)$/.test(type.name) || type.name == "Property") return statementIndent
    return undefined
  }),
  foldNodeProp.add({
    Block(tree: Subtree) { return {from: tree.start + 1, to: tree.end - 1} },
    BlockComment(tree: Subtree) { return {from: tree.start + 2, to: tree.end - 2} }
  }),
  styleTags({
    "get set async static": "modifier",
    "for while do if else switch try catch finally return throw break continue default case": "keyword control",
    "in of await yield void typeof delete instanceof": "operatorKeyword",
    "export import let var const function class extends": "keyword definition",
    "with debugger from as": "keyword",
    TemplateString: "string#2",
    "BooleanLiteral Super": "atom",
    this: "self",
    null: "null",
    Star: "modifier",
    VariableName: "variableName",
    VariableDefinition: "variableName definition",
    Label: "labelName",
    PropertyName: "propertyName",
    PropertyNameDefinition: "propertyName definition",
    "PostfixOp UpdateOp": "updateOperator",
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
    ", ;": "separator"
  })
))

/// Returns an extension that installs the JavaScript syntax provider.
export function javascript() { return javascriptSyntax.extension }
