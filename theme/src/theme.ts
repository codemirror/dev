import {StyleModule, Style} from "style-mod"
import {ViewExtension, styleModule, themeClass} from "../../view/src"
import {TagMatch, TagMatchSpec} from "lezer-tree"

function mapSpec<A, B>(spec: TagMatchSpec<A>, f: (a: A) => B): TagMatchSpec<B> {
  let result: {[name: string]: B | TagMatchSpec<B>} = {}
  for (let prop in spec)
    result[prop] = /^\./.test(prop) ? mapSpec(spec[prop] as TagMatchSpec<A>, f) : f(spec[prop] as A)
  return result
}

export function theme(rules: TagMatchSpec<Style>) {
  let styleObj: {[name: string]: Style} = {}, classID = 1
  let toClassName = mapSpec(rules, (style: Style) => {
    let name = "c" + (classID++)
    styleObj[name] = style
    return name
  })
  let styles = new StyleModule(styleObj)
  let match = new TagMatch(mapSpec(toClassName, name => styles[name]))
  return ViewExtension.all(
    themeClass((tag, context) => match.best(tag, context) || ""),
    styleModule(styles)
  )
}

export const defaultTheme = theme({
  "keyword": {color: "#708"},
  "keyword.expression, literal.expression": {color: "#219"},
  "number.literal.expression": {color: "#164"},
  "string.literal.expression": {color: "#a11"},
  "regexp.literal.expression": {color: "#e40"},
  "variable.definition.name": {color: "#00f"},
  "type.name": {color: "#085"},
  "comment": {color: "#940"},
  "metadata": {color: "#555"},
  "definition.property.name": {color: "#00c"},

  ".bracket": {
    "matching": {color: "#0b0"},
    "nonmatching": {color: "#a22"}
  }
})
