import {configureHTML} from "lezer-html"
import {cssSyntax} from "../../css/src/css"
import {javascriptSyntax} from "../../javascript/src/javascript"
import {LezerSyntax, delimitedIndent, statementIndent, indentNodeProp, openNodeProp, closeNodeProp} from "../../lezer-syntax/src"
import {NodeType} from "lezer-tree"
import {Style as s, styleNodeProp} from "../../theme/src"

export const htmlSyntax = new LezerSyntax(configureHTML([
  {tag: "script",
   attrs(attrs) {
     return !attrs.type || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^module$|^$/i.test(attrs.type)
   },
   parser: javascriptSyntax.parser},
  {tag: "style",
   attrs(attrs) {
     return (!attrs.lang || attrs.lang == "css") && (!attrs.type || /^(text\/)?(x-)?(stylesheet|css)$/i.test(attrs.type))
   },
   parser: cssSyntax.parser}
]).withProps(
  indentNodeProp.add(type => {
    if (type.name == "Element") return delimitedIndent({closing: "</", align: false})
    if (type.name == "OpenTag" || type.name == "CloseTag" || type.name == "SelfClosingTag") return statementIndent // FIXME name
    return undefined
  }),
  openNodeProp.add(NodeType.match({
    "StartTag StartCloseTag": ["EndTag", "SelfCloseEndTag"],
    "OpenTag": ["CloseTag"]
  })),
  closeNodeProp.add(NodeType.match({
    "EndTag SelfCloseEndTag": ["StartTag", "StartCloseTag"],
    "CloseTag": ["OpenTag"]
  })),
  styleNodeProp.styles(NodeType.match({
    AttributeValue: s.literal.string,
    RawText: s.markup.content,
    StartTag: s.bracket.angle.open,
    StartCloseTag: s.bracket.angle.open,
    SelfCloserEndTag: s.bracket.angle.close,
    EndTag: s.bracket.angle.close,
    SelfCloseEndTag: s.bracket.angle.close,
    TagName: s.name.type,
    MismatchedTagName: s.invalid.unexpected,
    AttributeName: s.name.property,
    UnquotedAttributeValue: s.name.value,
    Is: s.operator.define,
    EntityReference: s.literal.character,
    CharacterReference: s.literal.character,
    Text: s.markup.content,
    Comment: s.comment.block,
    ProcessingInst: s.meta.instruction,
    DoctypeDecl: s.meta.declaration
  }))
))

export function html() {
  return htmlSyntax.extension
}
