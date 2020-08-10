import {configureHTML} from "lezer-html"
import {Subtree} from "lezer-tree"
import {cssSyntax} from "@codemirror/next/lang-css"
import {javascriptSyntax, javascriptSupport} from "@codemirror/next/lang-javascript"
import {LezerSyntax, delimitedIndent, continuedIndent, indentNodeProp, foldNodeProp} from "@codemirror/next/syntax"
import {styleTags} from "@codemirror/next/highlight"
import {completeHTML} from "./complete"
import {Extension} from "@codemirror/next/state"

/// A syntax provider based on the [Lezer HTML
/// parser](https://github.com/lezer-parser/html), wired up with the
/// JavaScript and CSS parsers to parse the content of `<script>` and
/// `<style>` tags.
export const htmlSyntax = LezerSyntax.define(configureHTML([
  {tag: "script",
   attrs(attrs) {
     return !attrs.type || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^module$|^$/i.test(attrs.type)
   },
   parser: javascriptSyntax.parser},
  {tag: "style",
   attrs(attrs) {
     return (!attrs.lang || attrs.lang == "css") && (!attrs.type || /^(text\/)?(x-)?(stylesheet|css)$/i.test(attrs.type))
   },
   parser: cssSyntax.parser}
]).withProps(
  indentNodeProp.add(type => {
    if (type.name == "Element") return delimitedIndent({closing: "</", align: false})
    if (type.name == "OpenTag" || type.name == "CloseTag" || type.name == "SelfClosingTag") return continuedIndent()
    return undefined
  }),
  foldNodeProp.add({
    Element(subtree: Subtree) {
      let first = subtree.firstChild, last = subtree.lastChild!
      if (!first || first.name != "OpenTag") return null
      return {from: first.end, to: last.name == "CloseTag" ? last.start : subtree.end}
    }
  }),
  styleTags({
    AttributeValue: "string",
    "Text RawText": "content",
    "StartTag StartCloseTag SelfCloserEndTag EndTag SelfCloseEndTag": "angleBracket",
    TagName: "typeName",
    MismatchedTagName: "typeName invalid",
    AttributeName: "propertyName",
    UnquotedAttributeValue: "string",
    Is: "operator definition",
    "EntityReference CharacterReference": "character",
    Comment: "blockComment",
    ProcessingInst: "operator meta",
    DoctypeDecl: "labelName meta"
  })
), {
  languageData: {
    commentTokens: {block: {open: "<!--", close: "-->"}},
  }
})

/// HTML tag completion. Opens and closes tags and attributes in a
/// context-aware way.
export const htmlCompletion = htmlSyntax.languageData.of({autocomplete: completeHTML})

/// An extension that installs HTML-related functionality
/// ([`htmlCompletion`](#lang-html.htmlCompletion) and
/// [`javascriptSupport`](#lang-javascript.javascriptSupport)).
export function htmlSupport(): Extension { return [htmlCompletion, javascriptSupport()] }

/// Returns an extension that installs the HTML
/// [syntax](#lang-html.htmlSyntax) and
/// [support](#lang-html.htmlSupport).
export function html(): Extension { return [htmlSyntax, htmlSupport()] }
