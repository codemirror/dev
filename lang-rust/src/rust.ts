import {parser} from "lezer-rust"
import {continuedIndent, indentNodeProp, foldNodeProp, LezerLanguage} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {Extension} from "@codemirror/next/state"

/// A syntax provider based on the [Lezer Rust
/// parser](https://github.com/lezer-parser/rust), extended with
/// highlighting and indentation information.
export const rustLanguage = LezerLanguage.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        IfExpression: continuedIndent({except: /^\s*({|else\b)/}),
        "String BlockComment": () => -1,
        "Statement MatchArm": continuedIndent()
      }),
      foldNodeProp.add(type => {
        if (/(Block|edTokens|List)$/.test(type.name)) return tree => ({from: tree.from + 1, to: tree.to - 1})
        if (type.name == "BlockComment") return tree => ({from: tree.from + 2, to: tree.to - 2})
        return undefined
      }),
      styleTags({
        "const macro_rules mod struct union enum type fn impl trait let use crate static": t.definitionKeyword,
        "pub unsafe async mut extern default move": t.modifier,
        "for if else loop while match continue break return await": t.controlKeyword,
        "as in ref": t.operatorKeyword,
        "where _ crate super dyn": t.keyword,
        "self": t.self,
        String: t.string,
        RawString: t.special(t.string),
        Boolean: t.bool,
        Identifier: t.variableName,
        BoundIdentifier: t.definition(t.variableName),
        LoopLabel: t.labelName,
        FieldIdentifier: t.propertyName,
        Lifetime: t.special(t.variableName),
        ScopeIdentifier: t.namespace,
        TypeIdentifier: t.typeName,
        "MacroInvocation/Identifier MacroInvocation/ScopedIdentifier/Identifier": t.macroName,
        "MacroInvocation/TypeIdentifier MacroInvocation/ScopedIdentifier/TypeIdentifier": t.macroName,
        "!": t.macroName,
        UpdateOp: t.updateOperator,
        LineComment: t.lineComment,
        BlockComment: t.blockComment,
        Integer: t.integer,
        Float: t.float,
        ArithOp: t.arithmeticOperator,
        LogicOp: t.logicOperator,
        BitOp: t.bitwiseOperator,
        CompareOp: t.compareOperator,
        "=": t.definitionOperator,
        ".. ... => ->": t.punctuation,
        "( )": t.paren,
        "[ ]": t.squareBracket,
        "{ }": t.brace,
        ".": t.derefOperator,
        "&": t.operator,
        ", ; ::": t.separator,
      })
    ]
  }),
  languageData: {
    commentTokens: {line: "//", block: {open: "/*", close: "*/"}},
    indentOnInput: /^\s*(?:\{|\})$/
  }
})

/// Returns an extension that installs the Rust language.
export function rust(): Extension {
  return rustLanguage
}
