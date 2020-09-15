import {Completion, CompletionContext, CompletionSource, completeFromList} from "@codemirror/next/autocomplete"
import {EditorState} from "@codemirror/next/state"
import {Subtree} from "lezer"
import {Type} from "./parser.terms"

function tokenBefore(tree: Subtree) {
  for (;;) {
    tree = tree.resolve(tree.start, -1)
    if (!tree || !/Comment/.test(tree.name)) return tree
  }
}

function stripQuotes(name: string) {
  let quoted = /^[`'"](.*)[`'"]$/.exec(name)
  return quoted ? quoted[1] : name
}

function sourceContext(state: EditorState, startPos: number) {
  let pos = state.tree.resolve(startPos, -1)
  let empty = false
  if (pos.name == "Identifier" || pos.name == "QuotedIdentifier") {
    empty = false
    let parent = null
    let dot = tokenBefore(pos)
    if (dot && dot.name == ".") {
      let before = tokenBefore(dot)
      if (before && before.name == "Identifier" || before.name == "QuotedIdentifier")
        parent = stripQuotes(state.sliceDoc(before.start, before.end).toLowerCase())
    }
    return {parent,
            from: pos.start,
            quoted: pos.name == "QuotedIdentifier" ? state.sliceDoc(pos.start, pos.start + 1) : null}
  } else if (pos.name == ".") {
    let before = tokenBefore(pos)
    if (before && before.name == "Identifier" || before.name == "QuotedIdentifier")
      return {parent: stripQuotes(state.sliceDoc(before.start, before.end).toLowerCase()),
              from: startPos,
              quoted: null}
  } else {
    empty = true
  }
  return {parent: null, from: startPos, quoted: null, empty}
}

function maybeQuoteCompletions(quote: string | null, completions: readonly Completion[]) {
  if (!quote) return completions
  return completions.map(c => ({...c, label: quote + c.label + quote, apply: undefined}))
}

const Span = /^[`'"]?\w*$/

export function completeFromSchema(schema: {[table: string]: readonly (string | Completion)[]},
                                   tables?: readonly Completion[],
                                   defaultTable?: string): CompletionSource {
  let byTable: {[table: string]: readonly Completion[]} = Object.create(null)
  for (let table in schema) byTable[table] = schema[table].map(val => {
    return typeof val == "string" ? {label: val, type: "property"} : val
  })
  let topOptions: readonly Completion[] =
    (tables || Object.keys(byTable).map(name => ({label: name, type: "type"} as Completion)))
    .concat(defaultTable && byTable[defaultTable] || [])

  return (context: CompletionContext) => {
    let {parent, from, quoted, empty} = sourceContext(context.state, context.pos)
    if (empty && !context.explicit) return null
    let options = topOptions
    if (parent) {
      let columns = byTable[parent]
      if (!columns) return null
      options = columns
    }
    let quoteAfter = quoted && context.state.sliceDoc(context.pos, context.pos + 1) == quoted
    return {
      from,
      to: quoteAfter ? context.pos + 1 : undefined,
      options: maybeQuoteCompletions(quoted, options),
      span: Span
    }
  }
}

export function completeKeywords(keywords: {[name: string]: number}) {
  return completeFromList(Object.keys(keywords).map(keyword => ({
    label: keyword,
    type: keywords[keyword] == Type ? "type" : "keyword",
    boost: -1
  })))
}
