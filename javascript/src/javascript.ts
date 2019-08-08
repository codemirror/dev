import {parser} from "lezer-javascript"
import {StateExtension} from "../../state/src/"
import {LezerSyntax} from "../../lezer-syntax/src/syntax"
import {syntaxIndentation, dontIndent, parens, braces, brackets, statement, compositeStatement} from "../../indent/src/indent"
import {TagMatch} from "lezer-tree"

const indentStrategies = new TagMatch({
  // FIXME force variable decl indentation to 4?
  // FIXME option to do hanging statements different from continued ones?
  "statement": statement,
  "if.conditional.statement": compositeStatement(/^else\b/),

  'delim="( )"': parens,
  'delim="[ ]"': brackets,
  'delim="{ }"': braces,

  "template.string.literal.expression": dontIndent,
  "block.comment": dontIndent

  // FIXME
  // "SwitchCase"
  // "SwitchDefault", "SwitchStatement"
  // "ConditionalExpression"
})

export const javascriptSyntax = new LezerSyntax(parser)

export function javascript() {
  return StateExtension.all(
    javascriptSyntax.extension,
    syntaxIndentation(javascriptSyntax, indentStrategies)
  )
}
