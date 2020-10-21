import {parser} from "lezer-json"
import {continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {Extension} from "@codemirror/next/state"
import {SyntaxNode} from "lezer-tree"
import {styleTags} from "@codemirror/next/highlight"

export {jsonParseLinter} from "./lint"

export const jsonSyntax = LezerSyntax.define(parser.withProps(
  indentNodeProp.add({
    Object: continuedIndent({except: /^\s*\}/}),
    Array: continuedIndent({except: /^\s*\]/})
  }),
  foldNodeProp.add({
    Object(subtree: SyntaxNode) { return {from: subtree.from + 1, to: subtree.to - 1} },
    Array(subtree: SyntaxNode) { return {from: subtree.from + 1, to: subtree.to - 1} }
  }),
  styleTags({
    String: "string",
    Number: "number",
    "True False": "bool",
    PropertyName: "propertyName",
    null: "null",
    ",": "separator",
    "[ ]": "squareBracket",
    "{ }": "brace"
  })
), {
  languageData: {
    closeBrackets: {brackets: ["[", "{", '"']},
    indentOnInput: /^\s*[\}\]]$/
  }
})

/// Returns an extension that installs the JSON syntax provider.
export function json(): Extension {
  return jsonSyntax
}
