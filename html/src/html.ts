import {configureHTML} from "lezer-html"
import {cssSyntax} from "../../css/src/css"
import {javascriptSyntax} from "../../javascript/src/javascript"
import {LezerSyntax, delimitedIndent, statementIndent, indentNodeProp} from "../../lezer-syntax/src"

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
]).withProps(indentNodeProp.source(type => {
  if (type.name == "Element") return delimitedIndent({closing: "</", align: false})
  if (type.name == "OpenTag" || type.name == "CloseTag" || type.name == "SelfClosingTag") return statementIndent // FIXME name
  return undefined
})))

export function html() {
  return htmlSyntax.extension
}
