import {parser} from "lezer-cpp"
import {flatIndent, continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {styleTags} from "@codemirror/next/highlight"
import {Extension} from "@codemirror/next/state"

/// A syntax provider based on the [Lezer C++
/// parser](https://github.com/lezer-parser/cpp), extended with
/// highlighting and indentation information.
export const cppSyntax = LezerSyntax.define(parser.withProps(
  indentNodeProp.add({
    IfStatement: continuedIndent({except: /^\s*({|else\b)/}),
    TryStatement: continuedIndent({except: /^\s*({|catch)\b/}),
    LabeledStatement: flatIndent,
    CaseStatement: context => context.baseIndent + context.unit,
    BlockComment: () => -1,
    Statement: continuedIndent({except: /^{/})
  }),
  foldNodeProp.add({
    "DeclarationList CompoundStatement EnumeratorList FieldDeclarationList InitializerList"
      (tree) { return {from: tree.from + 1, to: tree.to - 1} },
    BlockComment(tree) { return {from: tree.from + 2, to: tree.to - 2} }
  }),
  styleTags({
    "typedef struct union enum class typename decltype auto template operator friend noexcept namespace using __attribute__ __declspec __based": "keyword definition",
    "extern MsCallModifier MsPointerModifier extern static register inline const volatile restrict _Atomic mutable constexpr virtual explicit VirtualSpecifier Access": "modifier",
    "if else switch for while do case default return break continue goto throw try catch": "keyword control",
    "new sizeof delete static_assert": "operatorKeyword",
    "NULL nullptr": "null",
    this: "self",
    "True False": "bool",
    "TypeSize PrimitiveType": "typeName standard",
    TypeIdentifier: "typeName",
    FieldIdentifier: "propertyName",
    StatementIdentifier: "labelName",
    Identifier: "variableName",
    DestructorName: "name",
    NamespaceIdentifier: "namespace",
    OperatorName: "operator",
    ArithOp: "arithmeticOperator",
    LogicOp: "logicOperator",
    BitOp: "bitwiseOperator",
    CompareOp: "compareOperator",
    AssignOp: "operator definition",
    UpdateOp: "updateOperator",
    LineComment: "lineComment",
    BlockComment: "blockComment",
    Number: "number",
    String: "string",
    "RawString SystemLibString": "string#2",
    CharLiteral: "character",
    EscapeSequence: "escape",
    PreProcArg: "meta",
    "PreprocDirectiveName #include #ifdef #ifndef #if #define #else #endif #elif": "keyword#2",
    MacroName: "name#2",
    "( )": "paren",
    "[ ]": "squareBracket",
    "{ }": "brace",
    "< >": "angleBracket",
    ". ->": "derefOperator",
    ", ;": "separator"
  })
), {
  languageData: {
    commentTokens: {line: "//", block: {open: "/*", close: "*/"}},
    indentOnInput: /^\s*(?:case |default:|\{|\})$/
  }
})

/// Returns an extension that installs the C++ syntax and
/// support features.
export function cpp(): Extension {
  return [cppSyntax]
}
