import {parser, configureNesting} from "lezer-html"
import {cssLanguage} from "@codemirror/next/lang-css"
import {javascriptLanguage, javascriptSupport} from "@codemirror/next/lang-javascript"
import {Language, delimitedIndent, continuedIndent, indentNodeProp, foldNodeProp} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {completeHTML} from "./complete"
import {Extension} from "@codemirror/next/state"

/// A language provider based on the [Lezer HTML
/// parser](https://github.com/lezer-parser/html), wired up with the
/// JavaScript and CSS parsers to parse the content of `<script>` and
/// `<style>` tags.
export const htmlLanguage = Language.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add(type => {
        if (type.name == "Element") return delimitedIndent({closing: "</", align: false})
        if (type.name == "OpenTag" || type.name == "CloseTag" || type.name == "SelfClosingTag") return continuedIndent()
        return undefined
      }),
      foldNodeProp.add({
        Element(node) {
          let first = node.firstChild, last = node.lastChild!
          if (!first || first.name != "OpenTag") return null
          return {from: first.to, to: last.name == "CloseTag" ? last.from : node.to}
        }
      }),
      styleTags({
        AttributeValue: t.string,
        "Text RawText": t.content,
        "StartTag StartCloseTag SelfCloserEndTag EndTag SelfCloseEndTag": t.angleBracket,
        TagName: t.typeName,
        "MismatchedCloseTag/TagName": [t.typeName,  t.invalid],
        AttributeName: t.propertyName,
        UnquotedAttributeValue: t.string,
        Is: t.definitionOperator,
        "EntityReference CharacterReference": t.character,
        Comment: t.blockComment,
        ProcessingInst: t.processingInstruction,
        DoctypeDecl: t.documentMeta
      })
    ],
    nested: configureNesting([
      {tag: "script",
       attrs(attrs) {
         return !attrs.type || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^module$|^$/i.test(attrs.type)
       },
       parser: javascriptLanguage.parser},
      {tag: "style",
       attrs(attrs) {
         return (!attrs.lang || attrs.lang == "css") && (!attrs.type || /^(text\/)?(x-)?(stylesheet|css)$/i.test(attrs.type))
       },
       parser: cssLanguage.parser}
    ])
  }),
  languageData: {
    commentTokens: {block: {open: "<!--", close: "-->"}},
    indentOnInput: /^\s*<\/$/
  }
})

/// HTML tag completion. Opens and closes tags and attributes in a
/// context-aware way.
export const htmlCompletion = htmlLanguage.data.of({autocomplete: completeHTML})

/// An extension that installs HTML-related functionality
/// ([`htmlCompletion`](#lang-html.htmlCompletion) and
/// [`javascriptSupport`](#lang-javascript.javascriptSupport)).
export function htmlSupport(): Extension { return [htmlCompletion, javascriptSupport()] }

/// Returns an extension that installs the HTML
/// [language](#lang-html.htmlLanguage) and
/// [support](#lang-html.htmlSupport).
export function html(): Extension { return [htmlLanguage, htmlSupport()] }
