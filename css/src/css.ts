import {parser} from "lezer-css"
import {NodeProp, NodeType} from "lezer-tree"
import {LezerSyntax, braceIndent, parenIndent, statementIndent, indentNodeProp} from "../../lezer-syntax/src"
import {styleNodeProp, Style as s} from "../../theme/src"

export const cssSyntax = new LezerSyntax(parser.withProps(
  indentNodeProp.add(type => {
    if (type.prop(NodeProp.delim) == "( )") return parenIndent
    if (type.prop(NodeProp.delim) == "{ }") return braceIndent
    if (type.name == "Declaration") return statementIndent
    return undefined
  }),
  styleNodeProp.styles(NodeType.match({
    "import charset namespace keyframes": s.keyword.define,
    "media supports": s.keyword.control,
    "from to": s.keyword,
    NamespaceName: s.name.namespace,
    KeyframeName: s.name.label,
    TagName: s.name.type,
    ClassName: s.name.class,
    PseudoClassName: s.name.constant,
    not: s.name.constant,
    IdName: s.name.label,
    AttributeName: s.name.property,
    NumberLiteral: s.literal.number,
    PropertyName: s.name.property,
    KeywordQuery: s.keyword,
    FeatureName: s.name.property,
    UnaryQueryOp: s.keyword.operator,
    callee: s.keyword,
    ValueName: s.name.value,
    CallTag: s.keyword.expression,
    Callee: s.name.variable,
    Unit: s.keyword.unit,
    "UniversalSelector NestingSelector": s.operator.define,
    AtKeyword: s.keyword,
    MatchOp: s.operator.compare,
    "ChildOp SiblingOp, LogicOp": s.operator.logic,
    BinOp: s.operator.arithmetic,
    Important: s.keyword.modifier,
    Comment: s.comment.block,
    ParenthesizedContent: s.literal,
    ColorLiteral: s.literal.color,
    StringLiteral: s.literal.string,
    ":": s.punctuation.define,
    "PseudoOp #": s.operator.deref,
    "; ,": s.punctuation.separator,
    "(": s.bracket.paren.open,
    ")": s.bracket.paren.close,
    "[": s.bracket.square.open,
    "]": s.bracket.square.close,
    "{": s.bracket.brace.open,
    "}": s.bracket.brace.close
  }))
))

export function css() {
  return cssSyntax.extension
}
