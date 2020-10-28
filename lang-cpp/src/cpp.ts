import {parser} from "lezer-cpp"
import {flatIndent, continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {styleTags, tags as t} from "@codemirror/next/highlight"
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
    "typedef struct union enum class typename decltype auto template operator friend noexcept namespace using __attribute__ __declspec __based": t.definitionKeyword,
    "extern MsCallModifier MsPointerModifier extern static register inline const volatile restrict _Atomic mutable constexpr virtual explicit VirtualSpecifier Access": t.modifier,
    "if else switch for while do case default return break continue goto throw try catch": t.controlKeyword,
    "new sizeof delete static_assert": t.operatorKeyword,
    "NULL nullptr": t.null,
    this: t.self,
    "True False": t.bool,
    "TypeSize PrimitiveType": t.standard(t.typeName),
    TypeIdentifier: t.typeName,
    FieldIdentifier: t.propertyName,
    StatementIdentifier: t.labelName,
    Identifier: t.variableName,
    DestructorName: t.name,
    NamespaceIdentifier: t.namespace,
    OperatorName: t.operator,
    ArithOp: t.arithmeticOperator,
    LogicOp: t.logicOperator,
    BitOp: t.bitwiseOperator,
    CompareOp: t.compareOperator,
    AssignOp: t.definitionOperator,
    UpdateOp: t.updateOperator,
    LineComment: t.lineComment,
    BlockComment: t.blockComment,
    Number: t.number,
    String: t.string,
    "RawString SystemLibString": t.special(t.string),
    CharLiteral: t.character,
    EscapeSequence: t.escape,
    PreProcArg: t.meta,
    "PreprocDirectiveName #include #ifdef #ifndef #if #define #else #endif #elif": t.processingInstruction,
    MacroName: t.special(t.name),
    "( )": t.paren,
    "[ ]": t.squareBracket,
    "{ }": t.brace,
    "< >": t.angleBracket,
    ". ->": t.derefOperator,
    ", ;": t.separator
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
