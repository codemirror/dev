import {parser} from "lezer-java"
import {flatIndent, continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {styleTags} from "@codemirror/next/highlight"
import {Extension} from "@codemirror/next/state"

/// A syntax provider based on the [Lezer Java
/// parser](https://github.com/lezer-parser/java), extended with
/// highlighting and indentation information.
export const javaSyntax = LezerSyntax.define(parser.withProps(
  indentNodeProp.add({
    IfStatement: continuedIndent({except: /^\s*({|else\b)/}),
    TryStatement: continuedIndent({except: /^\s*({|catch|finally)\b/}),
    LabeledStatement: flatIndent,
    SwitchBlock: context => {
      let after = context.textAfter, closed = /^\s*\}/.test(after), isCase = /^\s*(case|default)\b/.test(after)
      return context.baseIndent + (closed ? 0 : isCase ? 1 : 2) * context.unit
    },
    BlockComment: () => -1,
    Statement: continuedIndent({except: /^{/})
  }),
  foldNodeProp.add({
    "Block SwitchBlock ClassBody ElementValueArrayInitializer ModuleBody EnumBody ConstructorBody InterfaceBody ArrayInitializer"
      (tree) { return {from: tree.from + 1, to: tree.to - 1} },
    BlockComment(tree) { return {from: tree.from + 2, to: tree.to - 2} }
  }),
  styleTags({
    null: "null",
    instanceof: "operatorKeyword",
    this: "self",
    "new super assert open to with void": "keyword",
    "class interface extends implements module package import enum": "keyword definition",
    "switch while for if else case default do break continue return try catch finally throw": "keyword control",
    ["requires exports opens uses provides public private protected static transitive abstract final " +
     "strictfp synchronized native transient volatile throws"]: "modifier",
    IntegerLiteral: "integer",
    FloatLiteral: "float",
    StringLiteral: "string",
    CharacterLiteral: "character",
    LineComment: "lineComment",
    BlockComment: "blockComment",
    BooleanLiteral: "bool",
    PrimitiveType: "typeName standard",
    TypeName: "typeName",
    Identifier: "name",
    Definition: "variableName definition",
    ArithOp: "arithmeticOperator",
    LogicOp: "logicOperator",
    BitOp: "bitwiseOperator",
    CompareOp: "compareOperator",
    AssignOp: "operator definition",
    UpdateOp: "updateOperator",
    Asterisk: "punctuation",
    Label: "labelName",
    "( )": "paren",
    "[ ]": "squareBracket",
    "{ }": "brace",
    ".": "derefOperator",
    ", ;": "separator"
  })
), {
  languageData: {
    commentTokens: {line: "//", block: {open: "/*", close: "*/"}},
    indentOnInput: /^\s*(?:case |default:|\{|\})$/
  }
})

/// Returns an extension that installs the Java syntax and
/// support features.
export function java(): Extension {
  return [javaSyntax]
}
