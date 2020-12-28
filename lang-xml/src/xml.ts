import {parser} from "lezer-xml"
import {indentNodeProp, foldNodeProp, LezerLanguage, LanguageSupport} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {ElementSpec, AttrSpec, completeFromSchema} from "./complete"

/// A language provider based on the [Lezer XML
/// parser](https://github.com/lezer-parser/xml), extended with
/// highlighting and indentation information.
export const xmlLanguage = LezerLanguage.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Element(context) {
          let closed = /^\s*<\//.test(context.textAfter)
          return context.lineIndent(context.state.doc.lineAt(context.node.from)) + (closed ? 0 : context.unit)
        },
        "OpenTag CloseTag SelfClosingTag"(context) {
          return context.column(context.node.from) + context.unit
        }
      }),
      foldNodeProp.add({
        Element(subtree) {
          let first = subtree.firstChild, last = subtree.lastChild!
          if (!first || first.name != "OpenTag") return null
          return {from: first.to, to: last.name == "CloseTag" ? last.from : subtree.to}
        }
      }),
      styleTags({
        AttributeValue: t.string,
        Text: t.content,
        "StartTag StartCloseTag EndTag SelfCloseEndTag": t.angleBracket,
        TagName: t.typeName,
        "MismatchedCloseTag/Tagname": [t.typeName, t.invalid],
        AttributeName: t.propertyName,
        UnquotedAttributeValue: t.string,
        Is: t.definitionOperator,
        "EntityReference CharacterReference": t.character,
        Comment: t.blockComment,
        ProcessingInst: t.processingInstruction,
        DoctypeDecl: t.documentMeta,
        Cdata: t.special(t.string)
      })
    ]
  }),
  languageData: {
    commentTokens: {block: {open: "<!--", close: "-->"}},
    indentOnInput: /^\s*<\/$/
  }
})

type XMLConfig = {
  /// Provide a schema to create completions from.
  elements?: readonly ElementSpec[],
  /// Supporting attribute descriptions for the schema specified in
  /// [`elements`](#lang-xml.xml^conf.elements).
  attributes?: readonly AttrSpec[]
}

/// XML language support. Includes schema-based autocompletion when
/// configured.
export function xml(conf: XMLConfig = {}) {
  return new LanguageSupport(xmlLanguage, xmlLanguage.data.of({
    autocomplete: completeFromSchema(conf.elements || [], conf.attributes || [])
  }))
}
