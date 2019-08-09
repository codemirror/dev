import {parser} from "lezer-javascript"
import {StateExtension} from "../../state/src/"
import {syntaxIndentation, dontIndent, parenIndent, braceIndent, bracketIndent, statementIndent, compositeStatementIndent,
        LezerSyntax} from "../../lezer-syntax/src"

const indentStrategies = {
  // FIXME force variable decl indentation to 4?
  // FIXME option to do hanging statements different from continued ones?
  "statement": statementIndent,
  "if.conditional.statement": compositeStatementIndent(/^else\b/),

  'delim="( )"': parenIndent,
  'delim="[ ]"': bracketIndent,
  'delim="{ }"': braceIndent,

  "template.string.literal.expression": dontIndent,
  "block.comment": dontIndent

  // FIXME
  // "SwitchCase"
  // "SwitchDefault", "SwitchStatement"
  // "ConditionalExpression"
}

export const javascriptSyntax = new LezerSyntax(parser)

export function javascript() {
  return StateExtension.all(
    javascriptSyntax.extension,
    syntaxIndentation(javascriptSyntax, indentStrategies)
  )
}
