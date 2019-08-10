import {parser} from "lezer-html"
import {LezerSyntax, dontIndent, delimitedIndent, statementIndent} from "../../lezer-syntax/src"

const indentation = {
  "element.expression": delimitedIndent({closing: "</", align: false}),
  "tag": statementIndent, // FIXME name
  "raw.text.literal.expression": dontIndent
}

export const htmlSyntax = new LezerSyntax({parser, indentation})

export function html() {
  return htmlSyntax.extension
}
