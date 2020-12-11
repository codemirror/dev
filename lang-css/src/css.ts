import {parser} from "lezer-css"
import {SyntaxNode} from "lezer-tree"
import {LezerLanguage, continuedIndent, indentNodeProp, foldNodeProp} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {Extension} from "@codemirror/next/state"
import {completeCSS} from "./complete"

/// A language provider based on the [Lezer CSS
/// parser](https://github.com/lezer-parser/css), extended with
/// highlighting and indentation information.
export const cssLanguage = LezerLanguage.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Declaration: continuedIndent()
      }),
      foldNodeProp.add({
        Block(subtree: SyntaxNode) { return {from: subtree.from + 1, to: subtree.to - 1} }
      }),
      styleTags({
        "import charset namespace keyframes": t.definitionKeyword,
        "media supports": t.controlKeyword,
        "from to": t.keyword,
        NamespaceName: t.namespace,
        KeyframeName: t.labelName,
        TagName: t.typeName,
        ClassName: t.className,
        PseudoClassName: t.constant(t.className),
        not: t.operatorKeyword,
        IdName: t.labelName,
        "FeatureName PropertyName AttributeName": t.propertyName,
        NumberLiteral: t.number,
        KeywordQuery: t.keyword,
        UnaryQueryOp: t.operatorKeyword,
        callee: t.keyword,
        "CallTag ValueName": t.atom,
        Callee: t.variableName,
        Unit: t.unit,
        "UniversalSelector NestingSelector": t.definitionOperator,
        AtKeyword: t.keyword,
        MatchOp: t.compareOperator,
        "ChildOp SiblingOp, LogicOp": t.logicOperator,
        BinOp: t.arithmeticOperator,
        Important: t.modifier,
        Comment: t.blockComment,
        ParenthesizedContent: t.special(t.name),
        ColorLiteral: t.color,
        StringLiteral: t.string,
        ":": t.punctuation,
        "PseudoOp #": t.derefOperator,
        "; ,": t.separator,
        "( )": t.paren,
        "[ ]": t.squareBracket,
        "{ }": t.brace
      })
    ]
  }),
  languageData: {
    commentTokens: {block: {open: "/*", close: "*/"}},
    indentOnInput: /^\s*\}$/
  }
})

/// CSS property and value keyword completion.
export const cssCompletion: Extension = cssLanguage.data.of({autocomplete: completeCSS})

/// Provides support functionality for CSS ([completion](#lang-css.cssCompletion)).
export function cssSupport(): Extension {
  return cssCompletion
}

/// Returns an extension that installs the CSS language.
export function css(): Extension {
  return [cssLanguage, cssSupport()]
}
