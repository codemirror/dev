import {parser} from "lezer-javascript"
import {LezerSyntax, flatIndent, continuedIndent, indentNodeProp, foldNodeProp, delimitedIndent} from "@codemirror/next/syntax"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {completeSnippets} from "@codemirror/next/autocomplete"
import {Extension} from "@codemirror/next/state"
import {snippets} from "./snippets"

/// A syntax provider based on the [Lezer JavaScript
/// parser](https://github.com/lezer-parser/javascript), extended with
/// highlighting and indentation information.
export const javascriptSyntax = LezerSyntax.fromLezer({
  parser,
  props: [
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
      "get set async static": t.modifier,
      "for while do if else switch try catch finally return throw break continue default case": t.controlKeyword,
      "in of await yield void typeof delete instanceof": t.operatorKeyword,
      "export import let var const function class extends": t.definitionKeyword,
      "with debugger from as new": t.keyword,
      TemplateString: t.special(t.string),
      Super: t.atom,
      BooleanLiteral: t.bool,
      this: t.self,
      null: t.null,
      Star: t.modifier,
      VariableName: t.variableName,
      VariableDefinition: t.definition(t.variableName),
      Label: t.labelName,
      PropertyName: t.propertyName,
      PropertyNameDefinition: t.definition(t.propertyName),
      UpdateOp: t.updateOperator,
      LineComment: t.lineComment,
      BlockComment: t.blockComment,
      Number: t.number,
      String: t.string,
      ArithOp: t.arithmeticOperator,
      LogicOp: t.logicOperator,
      BitOp: t.bitwiseOperator,
      CompareOp: t.compareOperator,
      RegExp: t.regexp,
      Equals: t.definitionOperator,
      "Arrow : Spread": t.punctuation,
      "( )": t.paren,
      "[ ]": t.squareBracket,
      "{ }": t.brace,
      ".": t.derefOperator,
      ", ;": t.separator,

      TypeName: t.typeName,
      TypeDefinition: t.definition(t.typeName),
      "type enum interface implements namespace module declare": t.definitionKeyword,
      "abstract global privacy readonly": t.modifier,
      "is keyof unique infer": t.operatorKeyword,

      JSXAttributeValue: t.string,
      JSXText: t.content,
      "JSXStartTag JSXStartCloseTag JSXSelfCloseEndTag JSXEndTag": t.angleBracket,
      "JSXIdentifier JSXNameSpacedName": t.typeName,
      "JSXAttribute/JSXIdentifier JSXAttribute/JSXNameSpacedName": t.propertyName
    })
  ],
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

const dialects: {[dialect: string]: LezerSyntax} = {"": javascriptSyntax}
function getDialect(dialect: string) {
  return dialects[dialect] || (dialects[dialect] = javascriptSyntax.reconfigure({dialect: "jsx"}))
}

/// Returns an extension that installs the JavaScript syntax and
/// support features.
export function javascript(config: {jsx?: boolean, typescript?: boolean} = {}): Extension {
  let dialect = (config.jsx ? ["jsx"] : []).concat(config.typescript ? ["ts"] : []).join(" ")
  return [getDialect(dialect), javascriptSupport()]
}
