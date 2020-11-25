import {parser} from "lezer-json"
import {continuedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {Extension} from "@codemirror/next/state"
import {SyntaxNode} from "lezer-tree"
import {styleTags, tags as t} from "@codemirror/next/highlight"

export {jsonParseLinter} from "./lint"

export const jsonSyntax = LezerSyntax.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Object: continuedIndent({except: /^\s*\}/}),
        Array: continuedIndent({except: /^\s*\]/})
      }),
      foldNodeProp.add({
        Object(subtree: SyntaxNode) { return {from: subtree.from + 1, to: subtree.to - 1} },
        Array(subtree: SyntaxNode) { return {from: subtree.from + 1, to: subtree.to - 1} }
      }),
      styleTags({
        String: t.string,
        Number: t.number,
        "True False": t.bool,
        PropertyName: t.propertyName,
        null: t.null,
        ",": t.separator,
        "[ ]": t.squareBracket,
        "{ }": t.brace
      })
    ]
  }),
  languageData: {
    closeBrackets: {brackets: ["[", "{", '"']},
    indentOnInput: /^\s*[\}\]]$/
  }
})

/// Returns an extension that installs the JSON syntax provider.
export function json(): Extension {
  return jsonSyntax
}
