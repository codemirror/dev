import {TagMap} from "lezer"
import parser from "lezer-javascript"
import {StateExtension} from "../../state/src/"
import {LezerSyntax} from "../../syntax/src/syntax"

const scopes = new TagMap(parser, {
  Definition: "variable-2",
  PropertyName: "property",
  Template: "string-2",
  Variable: "variable",
  Operator: "operator",
  Label: "meta",
  Comment: "comment",
  Keyword: "keyword",
  String: "string",
  Number: "number",
  Boolean: "atom",
  This: "keyword",
  Null: "atom",
  Super: "keyword"
})

export const javascriptSyntax = new LezerSyntax(parser, scopes, [])

export function javascript() {
  return StateExtension.all(
    javascriptSyntax.extension
    // ... indentation, etc
  )
}
