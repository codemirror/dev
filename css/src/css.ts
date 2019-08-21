import {parser} from "lezer-css"
import {NodeProp} from "lezer-tree"
import {LezerSyntax, braceIndent, parenIndent, statementIndent, indentNodeProp} from "../../lezer-syntax/src"

export const cssSyntax = new LezerSyntax(parser.withProps(indentNodeProp.source(type => {
  if (type.prop(NodeProp.delim) == "( )") return parenIndent
  if (type.prop(NodeProp.delim) == "{ }") return braceIndent
  if (type.name == "Declaration") return statementIndent
  return undefined
})))

export function css() {
  return cssSyntax.extension
}
