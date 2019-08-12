import {parser} from "lezer-css"
import {LezerSyntax, braceIndent, parenIndent} from "../../lezer-syntax/src"

const indentation = {
  'delim="( )"': parenIndent,
  'delim="{ }"': braceIndent
}

export const cssSyntax = new LezerSyntax({parser, indentation})

export function css() {
  return cssSyntax.extension
}
