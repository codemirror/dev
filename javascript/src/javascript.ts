import {parser} from "lezer-javascript"
import {NodeProp, NodeType} from "lezer-tree"
import {dontIndent, parenIndent, braceIndent, bracketIndent, statementIndent, compositeStatementIndent,
        indentNodeProp, LezerSyntax} from "../../lezer-syntax/src"
import {styleNodeProp, Style as s} from "../../theme/src"

export const javascriptSyntax = new LezerSyntax(parser.withProps(
  indentNodeProp.add(type => {
    let delim = type.prop(NodeProp.delim)
    if (delim == "( )") return parenIndent
    if (delim == "{ }") return braceIndent
    if (delim == "[ ]") return bracketIndent
    if (type.name == "IfStatement") return compositeStatementIndent(/^else\b/)
    if (/(Statement|Declaration)$/.test(type.name)) return statementIndent
    if (type.name == "TemplateString" || type.name == "BlockComment") return dontIndent
    return undefined

    // FIXME special indentation for switch bodies
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
