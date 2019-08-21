import {parser} from "lezer-javascript"
import {NodeProp} from "lezer-tree"
import {dontIndent, parenIndent, braceIndent, bracketIndent, statementIndent, compositeStatementIndent,
        indentNodeProp, LezerSyntax} from "../../lezer-syntax/src"

export const javascriptSyntax = new LezerSyntax(parser.withProps(indentNodeProp.source(type => {
  let delim = type.prop(NodeProp.delim)
  if (delim == "( )") return parenIndent
  if (delim == "{ }") return braceIndent
  if (delim == "[ ]") return bracketIndent
  if (type.name == "IfStatement") return compositeStatementIndent(/^else\b/)
  if (/(Statement|Declaration)$/.test(type.name)) return statementIndent
  if (type.name == "TemplateString" || type.name == "BlockComment") return dontIndent
  return undefined

  // FIXME special indentation for switch bodies
})))

export function javascript() { return javascriptSyntax.extension }
