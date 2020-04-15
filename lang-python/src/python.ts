import {parser} from "lezer-python"
import {continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {languageData} from "@codemirror/next/state"
import {Subtree} from "lezer-tree"
import {styleTags} from "@codemirror/next/highlight"

/// A syntax provider based on the [Lezer Python
/// parser](https://github.com/lezer-parser/python), extended with
/// highlighting and indentation information.
export const pythonSyntax = new LezerSyntax(parser.withProps(
  languageData.add({
    Script: {closeBrackets: {brackets: ["(", "[", "{", "'", '"', "'''", '"""']},
             commentTokens: {lineComment: "#"}}
  }),
  indentNodeProp.add({
    Body: continuedIndent()
  }),
  foldNodeProp.add({
    Body(tree: Subtree) { return {from: tree.start + 1, to: tree.end - 1} },
    ArrayExpression(tree: Subtree) { return {from: tree.start + 1, to: tree.end - 1} },
    DictionaryExpression(tree: Subtree) { return {from: tree.start + 1, to: tree.end - 1} }
  }),
  styleTags({
    "async * ** FormatConversion": "modifier",
    "for while if elif else try except finally return raise break continue with pass assert await yield": "keyword control",
    "in not and or is del": "operatorKeyword",
    "import from def class global nonlocal lambda": "keyword definition",
    "with as print": "keyword",
    self: "self",
    Boolean: "atom",
    None: "null",
    VariableName: "variableName",
    PropertyName: "propertyName",
    Comment: "lineComment",
    Number: "number",
    String: "string",
    FormatString: "string#2",
    UpdateOp: "updateOperator",
    ArithOp: "arithmeticOperator",
    BitOp: "bitwiseOperator",
    CompareOp: "compareOperator",
    AssignOp: "operator definition",
    Ellipsis: "punctuation",
    At: "punctuation meta",
    "( )": "paren",
    "[ ]": "squareBracket",
    "{ }": "brace",
    ".": "derefOperator",
    ", ;": "separator"
  })
))

/// Returns an extension that installs the Python syntax provider.
export function python() { return pythonSyntax.extension }
