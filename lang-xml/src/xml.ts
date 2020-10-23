import {parser} from "lezer-xml"
import {continuedIndent, delimitedIndent, indentNodeProp, foldNodeProp, LezerSyntax} from "@codemirror/next/syntax"
import {styleTags} from "@codemirror/next/highlight"
import {Extension} from "@codemirror/next/state"
import {ElementSpec, AttrSpec, completeFromSchema} from "./complete"

/// A syntax provider based on the [Lezer XML
/// parser](https://github.com/lezer-parser/xml), extended with
/// highlighting and indentation information.
export const xmlSyntax = LezerSyntax.define(parser.withProps(
  indentNodeProp.add(type => {
    if (type.name == "Element") return delimitedIndent({closing: "</", align: false})
    if (type.name == "OpenTag" || type.name == "CloseTag" || type.name == "SelfClosingTag") return continuedIndent()
    return undefined
  }),
  foldNodeProp.add({
    Element(subtree) {
      let first = subtree.firstChild, last = subtree.lastChild!
      if (!first || first.name != "OpenTag") return null
      return {from: first.to, to: last.name == "CloseTag" ? last.from : subtree.to}
    }
  }),
  styleTags({
    AttributeValue: "string",
    Text: "content",
    "StartTag StartCloseTag EndTag SelfCloseEndTag": "angleBracket",
    TagName: "typeName",
    "MismatchedCloseTag/Tagname": "typeName invalid",
    AttributeName: "propertyName",
    UnquotedAttributeValue: "string",
    Is: "operator definition",
    "EntityReference CharacterReference": "character",
    Comment: "blockComment",
    ProcessingInst: "operator meta",
    DoctypeDecl: "labelName meta",
    Cdata: "string#3"
  })
), {
  languageData: {
    commentTokens: {block: {open: "<!--", close: "-->"}},
    indentOnInput: /^\s*<\/$/
  }
})

/// Used to configure the XML extension.
export type XMLConfig = {
  /// Provide a schema to create completions from.
  elements?: readonly ElementSpec[],
  /// Supporting attribute descriptions for the schema specified in
  /// [`elements`](#lang-xml.XMLConfig.elements).
  attributes?: readonly AttrSpec[]
}

/// Return an extension that installs XML support functionality.
export function xmlSupport(conf: XMLConfig = {}): Extension {
  return xmlSyntax.languageData.of({
    autocomplete: completeFromSchema(conf.elements || [], conf.attributes || [])
  })
}

/// Returns an extension that installs the XML syntax and
/// support features.
export function xml(conf?: XMLConfig): Extension {
  return [xmlSyntax, xmlSupport(conf)]
}
