import {parser} from "lezer-javascript"
import {NodeType} from "lezer-tree"
import {flatIndent, continuedIndent, indentNodeProp, LezerSyntax} from "../../syntax"
import {styleNodeProp, Style as s} from "../../theme"

const statementIndent = continuedIndent({except: /^{/})

export const javascriptSyntax = new LezerSyntax(parser.withProps(
  indentNodeProp.add(type => {
    if (type.name == "IfStatement") return continuedIndent({except: /^({|else\b)/})
    if (type.name == "TryStatement") return continuedIndent({except: /^({|catch|finally)\b/})
    if (type.name == "LabeledStatement") return flatIndent
    if (type.name == "SwitchBody") return context => {
      let after = context.textAfter, closed = after[0] == "}", isCase = /^(case|default)\b/.test(after)
      return context.baseIndent + (closed ? 0 : isCase ? 1 : 2) * context.unit
    }
    if (type.name == "TemplateString" || type.name == "BlockComment") return () => -1
    if (/(Statement|Declaration)$/.test(type.name) || type.name == "Property") return statementIndent
    return undefined
  }),
  styleNodeProp.styles(NodeType.match({
    "get set async static": s.keyword.modifier,
    "for while do if else switch try catch finally return throw break continue default case": s.keyword.control,
    "in of await yield void typeof delete instanceof": s.keyword.operator,
    "export import let var const function class extends": s.keyword.define,
    "with debugger from as": s.keyword,
    TemplateString: s.literal.string.special,
    BooleanLiteral: s.keyword.expression,
    This: s.keyword.expression.self,
    Null: s.keyword.expression.null,
    Super: s.keyword.expression,
    Star: s.punctuation.marker,
    VariableName: s.name.variable,
    VariableDefinition: s.name.variable.define,
    Label: s.name.label,
    PropertyName: s.name.property,
    PropertyNameDefinition: s.name.property.define,
    PostfixOp: s.operator.update,
    LineComment: s.comment.line,
    BlockComment: s.comment.block,
    Number: s.literal.number,
    String: s.literal.string,
    ArithOp: s.operator.arithmetic,
    LogicOp: s.operator.logic,
    BitOp: s.operator.bitwise,
    CompareOp: s.operator.compare,
    UpdateOp: s.operator.update,
    RegExp: s.literal.regexp,
    Equals: s.operator.define,
    Spread: s.punctuation.modifier,
    Arrow: s.punctuation.define,
    "(": s.bracket.paren.open,
    ")": s.bracket.paren.close,
    "[": s.bracket.square.open,
    "]": s.bracket.square.close,
    "{": s.bracket.brace.open,
    "}": s.bracket.brace.close,
    ".": s.operator.deref,
    ", ;": s.punctuation.separator,
    ":": s.punctuation.define
  }))
))

export function javascript() { return javascriptSyntax.extension }
