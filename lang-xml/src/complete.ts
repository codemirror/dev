import {Completion, CompletionSource} from "@codemirror/next/autocomplete"
import {EditorState, Text} from "@codemirror/next/state"
import {SyntaxNode} from "lezer-tree"

/// Describes an element in your XML document schema.
export type ElementSpec = {
  /// The element name.
  name: string,
  /// Allowed children in this element. When not given, all elements
  /// are allowed inside it.
  children?: readonly string[],
  /// Whether this element may appear at the top of the document.
  top?: boolean,
  /// Allowed attributes in this element. Strings refer to attributes
  /// specified in [`XMLConfig.attrs`](#lang-xml.XMLConfig.attrs), but
  /// you can also provide one-off [attribute
  /// specs](#lang-xml.AttrSpec). Attributes marked as
  /// [`global`](#lang-xml.AttrSpec.global) are allowed in every
  /// element, and don't have to be mentioned here.
  attributes?: readonly (string | AttrSpec)[],
  /// Can be provided to add extra fields to the
  /// [completion](#autocompletion.Completion) object created for this
  /// element.
  completion?: Partial<Completion>
}

/// Describes an attribute in your XML schema.
export type AttrSpec = {
  /// The attribute name.
  name: string,
  /// Pre-defined values to complete for this attribute.
  values?: readonly (string | Completion)[],
  /// When `true`, this attribute can be added to all elements.
  global?: boolean,
  /// Provides extra fields to the
  /// [completion](#autocompletion.Completion) object created for this
  /// element
  completion?: Partial<Completion>
}

function tagName(doc: Text, tag: SyntaxNode | null) {
  let name = tag && tag.getChild("TagName")
  return name ? doc.sliceString(name.from, name.to) : ""
}

function elementName(doc: Text, tree: SyntaxNode | null) {
  let tag = tree && tree.firstChild
  return !tag || tag.name != "OpenTag" ? "" : tagName(doc, tag)
}

function attrName(doc: Text, tag: SyntaxNode | null, pos: number) {
  let attr = tag && tag.getChildren("Attribute").find(a => a.from <= pos && a.to >= pos)
  let name = attr && attr.getChild("AttributeName")
  return name ? doc.sliceString(name.from, name.to) : ""
}

function findParentElement(tree: SyntaxNode | null) {
  for (let cur = tree && tree.parent; cur; cur = cur.parent)
    if (cur.name == "Element") return cur
  return null
}

type Location = {
  type: "openTag" | "closeTag" | "attrValue" | "attrName" | "tag",
  from: number,
  context: SyntaxNode | null
} | null

function findLocation(state: EditorState, pos: number): Location {
  let at = state.tree.resolve(pos, -1), inTag = null
  for (let cur = at; !inTag && cur.parent; cur = cur.parent)
    if (cur.name == "OpenTag" || cur.name == "CloseTag" || cur.name == "SelfClosingTag")
      inTag = cur
  if (inTag && (inTag.to > pos || inTag.lastChild!.type.isError)) {
    let elt = inTag.parent!
    if (at.name == "TagName" || at.name == "MismatchedTagName")
      return inTag.name == "CloseTag"
        ? {type: "closeTag", from: at.from, context: elt}
        : {type: "openTag", from: at.from, context: findParentElement(elt)}
    if (at.name == "AttributeName")
      return {type: "attrName", from: at.from, context: inTag}
    if (at.name == "AttributeValue")
      return {type: "attrValue", from: at.from, context: inTag}
    let before = at == inTag || at.name == "Attribute" ? at.childBefore(pos) : at
    if (before?.name == "StartTag")
      return {type: "openTag", from: pos, context: findParentElement(elt)}
    if (before?.name == "StartCloseTag" && before.to <= pos)
      return {type: "closeTag", from: pos, context: elt}
    if (before?.name == "Is")
      return {type: "attrValue", from: pos, context: inTag}
    if (before)
      return {type: "attrName", from: pos, context: inTag}
    return null
  }
  while (at.parent && at.to == pos && !at.lastChild?.type.isError) at = at.parent
  if (at.name == "Element" || at.name == "Text" || at.name == "Document")
    return {type: "tag", from: pos, context: at.name == "Element" ? at : findParentElement(at)}
  return null
}

class Element {
  name: string
  completion: Completion
  openCompletion: Completion
  closeCompletion: Completion
  closeNameCompletion: Completion
  children: Element[] = []

  constructor(spec: ElementSpec,
              readonly attrs: readonly Completion[],
              readonly attrValues: {[name: string]: readonly Completion[]}) {
    this.name = spec.name
    this.completion = {type: "type", ...spec.completion || {}, label: this.name}
    this.openCompletion = {...this.completion, label: "<" + this.name}
    this.closeCompletion = {...this.completion, label: "</" + this.name + ">", boost: 2}
    this.closeNameCompletion = {...this.completion, label: this.name + ">"}
  }
}

const Identifier = /^[:\-\.\w\u00b7-\uffff]*$/

function attrCompletion(spec: AttrSpec): Completion {
  return {type: "property", ...spec.completion || {}, label: spec.name}
}

function valueCompletion(spec: string | Completion): Completion {
  return typeof spec == "string" ? {label: `"${spec}"`, type: "constant"}
    : /^"/.test(spec.label) ? spec
    : {...spec, label: `"${spec.label}"`}
}

export function completeFromSchema(eltSpecs: readonly ElementSpec[], attrSpecs: readonly AttrSpec[]): CompletionSource {
  let allAttrs: Completion[] = [], globalAttrs: Completion[] = []
  let attrValues: {[name: string]: readonly Completion[]} = Object.create(null)
  for (let s of attrSpecs) {
    let completion = attrCompletion(s)
    allAttrs.push(completion)
    if (s.global) globalAttrs.push(completion)
    if (s.values) attrValues[s.name] = s.values.map(valueCompletion)
  }

  let allElements: Element[] = [], topElements: Element[] = []
  let byName: {[name: string]: Element} = Object.create(null)
  for (let s of eltSpecs) {
    let attrs = globalAttrs, attrVals = attrValues
    if (s.attributes) attrs = attrs.concat(s.attributes.map(s => {
      if (typeof s == "string") return allAttrs.find(a => a.label == s) || {label: s, type: "property"}
      if (s.values) {
        if (attrVals == attrValues) attrVals = Object.create(attrVals)
        attrVals[s.name] = s.values.map(valueCompletion)
      }        
      return attrCompletion(s)
    }))
    let elt = new Element(s, attrs, attrVals)
    byName[elt.name] = elt
    allElements.push(elt)
    if (s.top) topElements.push(elt)
  }
  if (!topElements.length) topElements = allElements
  for (let i = 0; i < allElements.length; i++) {
    let s = eltSpecs[i], elt = allElements[i]
    if (s.children) {
      for (let ch of s.children) if (byName[ch]) elt.children.push(byName[ch])
    } else {
      elt.children = allElements
    }
  }

  return cx => {
    let {doc} = cx.state, loc = findLocation(cx.state, cx.pos)
    if (!loc || (loc.type == "tag" && !cx.explicit)) return null
    let {type, from, context} = loc
    if (type == "openTag") {
      let children = topElements
      let parentName = elementName(doc, context)
      if (parentName) {
        let parent = byName[parentName]
        children = parent?.children || allElements
      }
      return {
        from,
        options: children.map(ch => ch.completion),
        span: Identifier
      }
    } else if (type == "closeTag") {
      let parentName = elementName(doc, context)
      return parentName ? {
        from,
        to: cx.pos + (doc.sliceString(cx.pos, cx.pos + 1) == ">" ? 1 : 0),
        options: [byName[parentName]?.closeNameCompletion || {label: parentName + ">", type: "type"}],
        span: Identifier
      } : null
    } else if (type == "attrName") {
      let parent = byName[tagName(doc, context)]
      return {
        from,
        options: parent?.attrs || globalAttrs,
        span: Identifier
      }
    } else if (type == "attrValue") {
      let attr = attrName(doc, context, from)
      if (!attr) return null
      let parent = byName[tagName(doc, context)]
      let values = (parent?.attrValues || attrValues)[attr]
      if (!values || !values.length) return null
      return {
        from,
        to: cx.pos + (doc.sliceString(cx.pos, cx.pos + 1) == '"' ? 1 : 0),
        options: values,
        span: /^"[^"]*"?$/
      }
    } else if (type == "tag") {
      let parentName = elementName(doc, context), parent = byName[parentName]
      let closing = [], last = context && context.lastChild
      if (parentName && (!last || last.name != "CloseTag" || tagName(doc, last) != parentName))
        closing.push(parent ? parent.closeCompletion : {label: "</" + parentName + ">", type: "type", boost: 2})
      return {
        from,
        options: closing.concat((parent?.children || (context ? allElements : topElements)).map(e => e.openCompletion)),
        span: /^<\/?[:\-\.\w\u00b7-\uffff]*$/
      }
    } else {
      return null
    }
  }
}
