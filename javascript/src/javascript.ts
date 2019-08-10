import {parser} from "lezer-javascript"
import {dontIndent, parenIndent, braceIndent, bracketIndent, statementIndent, compositeStatementIndent,
        LezerSyntax} from "../../lezer-syntax/src"

const indentation = {
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

export const javascriptSyntax = new LezerSyntax({parser, indentation})

export function javascript() { return javascriptSyntax.extension }
