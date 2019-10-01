import {parser} from "lezer-css"
import {NodeType} from "lezer-tree"
import {LezerSyntax, continuedIndent, indentNodeProp} from "../../syntax"
import {styleNodeProp, Style as s} from "../../theme"

/// A syntax provider based on the [Lezer CSS
/// parser](https://github.com/lezer-parser/css), extended with
/// highlighting and indentation information.
export const cssSyntax = new LezerSyntax(parser.withProps(
  indentNodeProp.add(NodeType.match({
    Declaration: continuedIndent()
  })),
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

/// Returns an extension that installs the CSS syntax provider.
export function css() { return cssSyntax.extension }
