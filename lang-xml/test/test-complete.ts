import {EditorState} from "@codemirror/next/state"
import {CompletionContext, CompletionResult, CompletionSource} from "@codemirror/next/autocomplete"
import {xml, XMLConfig} from "@codemirror/next/lang-xml"
import ist from "ist"

function get(doc: string, config?: XMLConfig, explicit = true) {
  let cur = doc.indexOf("|")
  doc = doc.slice(0, cur) + doc.slice(cur + 1)
  let state = EditorState.create({doc, selection: {anchor: cur}, extensions: [xml(config)]})
  let result = state.languageDataAt<CompletionSource>("autocomplete", cur)[0](new CompletionContext(state, cur, explicit))
  return result as CompletionResult | null
}

function str(result: CompletionResult | null) {
  return !result ? "" : result.options.slice()
    .sort((a, b) => (b.boost || 0) - (a.boost || 0) || (a.label < b.label ? -1 : 1))
    .map(o => o.label)
    .join(", ")
}

let schema1 = {
  elements: [
    {name: "doc",
     top: true,
     attributes: ["attr1", "attr2", {name: "attr3", values: ["x", "y"], completion: {type: "keyword"}}],
     children: ["head", "body"],
     completion: {type: "keyword"}},
    {name: "head",
     attributes: ["attr2"]},
    {name: "body",
     children: []}
  ],
  attributes: [
    {name: "attr2", values: ["one", "two"]},
    {name: "attrglobal", global: true}
  ]
}

describe("XML completion", () => {
  it("completes closing tags", () => {
    ist(str(get("<foo>|")), "</foo>")
  })

  it("completes attributes after a tag name", () => {
    ist(str(get("<doc |", schema1)), "attr1, attr2, attr3, attrglobal")
  })

  it("completes attributes after a partial name", () => {
    ist(str(get("<doc att|>", schema1)), "attr1, attr2, attr3, attrglobal")
  })

  it("completes attributes after another attribute", () => {
    ist(str(get("<doc attr1=\"ok\" |>", schema1)), "attr1, attr2, attr3, attrglobal")
  })

  it("completes attribute values", () => {
    ist(str(get("<doc attr2=|>", schema1)), '"one", "two"')
  })

  it("completes partial attribute values", () => {
    ist(str(get("<doc attr2=\"o|>", schema1)), '"one", "two"')
  })

  it("completes locally defined attribute values", () => {
    ist(str(get("<doc attr3=|", schema1)), '"x", "y"')
  })

  it("doesn't complete for attributes without values", () => {
    ist(str(get("<doc attr1=|", schema1)), "")
  })

  it("completes tag names after a partial name", () => {
    ist(str(get("<doc><b|</doc>", schema1)), "body, head")
  })

  it("completes tag names after a tag start", () => {
    ist(str(get("<doc><|</doc>", schema1)), "body, head")
  })

  it("completes closing tag names", () => {
    ist(str(get("<doc></|", schema1)), "doc>")
    ist(str(get("<doc></d|", schema1)), "doc>")
  })

  it("completes tags when in text", () => {
    ist(str(get("<doc>foo|bar", schema1)), "</doc>, <body, <head")
  })

  it("doesn't complete close tags for already-closed elements", () => {
    ist(str(get("<doc>|</doc>", schema1)), "<body, <head")
  })

  it("only completes tags when explicit is true", () => {
    ist(str(get("<doc>|</doc>", schema1, false)), "")
  })

  it("can attach extra info to completions", () => {
    ist(get("<d|", schema1)!.options[0].type, "keyword")
    ist(get("<doc attr|", schema1)!.options.filter(c => c.label == "attr3")[0].type, "keyword")
  })

  it("completes the top element", () => {
    ist(str(get("|", schema1)), "<doc")
  })

  it("completes pre-provided text", () => {
    let schema = {
      elements: [{name: "top", textContent: ["true", "false"], children: []}]
    }
    ist(str(get("<top>|", schema)), "</top>, false, true")
    ist(str(get("<top>a|</top>", schema)), "")
  })
})
