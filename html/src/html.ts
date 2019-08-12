import {configureHTML} from "lezer-html"
import {cssSyntax} from "../../css/src/css"
import {javascriptSyntax} from "../../javascript/src/javascript"
import {LezerSyntax, delimitedIndent, statementIndent} from "../../lezer-syntax/src"

const indentation = {
  "element.expression": delimitedIndent({closing: "</", align: false}),
  "tag": statementIndent // FIXME name
}

export const htmlSyntax = new LezerSyntax({parser: configureHTML([
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
]), indentation})

export function html() {
  return htmlSyntax.extension
}
