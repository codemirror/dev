import {StyleModule, Style} from "style-mod"
import {EditorView} from "../../view/src"
import {StyleNames} from "./styleprop"

export type ThemeSpec = {[prop: string]: string | number | ThemeSpec}

type FlatStyle = {[prop: string]: string | number}
type FlatSpec = {name: string, value: FlatStyle}[]

function flattenSpec(spec: ThemeSpec) {
  let rules: FlatSpec = []
  function scan(spec: ThemeSpec, prefix: string) {
    let local: {[prop: string]: string | number} | null = null
    for (let prop in spec) {
      let value = spec[prop]
      if (typeof value == "object") {
        scan(value, prefix ? prefix + "." + prop : prop)
      } else {
        if (!local) local = {}
        local[prop] = value
      }
    }
    if (local) rules.push({name: prefix, value: local})
  }
  scan(spec, "")
  return rules
}

function collectTokenStyles(flat: FlatSpec, addStyle: (style: FlatStyle) => string) {
  let styles: {name: string, style: string, add: string}[] = []
  for (let {name, value} of flat) {
    if (!/^token\./.test(name)) continue
    let style: FlatStyle | null = null, add: FlatStyle | null = null
    for (let prop in value) {
      if (prop[0] == "+") {
        if (!add) add = {}
        add[prop.slice(1)] = value[prop]
      } else {
        if (!style) style = {}
        style[prop] = value[prop]
      }
    }
    styles.push({name: name.slice(6), style: style ? addStyle(style) : "", add: add ? addStyle(add) : ""})
  }
  return styles
}

function parseTheme(spec: ThemeSpec) {
  let styleObj: {[name: string]: Style} = {}, nextID = 0
  function addStyle(style: Style) {
    let id = "c" + nextID++
    styleObj[id] = style
    return id
  }

  let flat = flattenSpec(spec)
  let tokenStyles = collectTokenStyles(flat, addStyle)
  let otherStyles: {name: string, style: string}[] = []
  for (let {name, value} of flat) {
    if (/^token\./.test(name)) continue
    otherStyles.push({name, style: addStyle(value)})
  }

  let styleMod = new StyleModule(styleObj)

  let tokenArray = [], tokenAddArray = []
  for (let i = 0; i < StyleNames.length; i++) {
    let styleName = StyleNames[i], cls = "", selector = "", addCls = ""
    for (let {name, style, add} of tokenStyles) {
      let match = styleName.indexOf(name) == 0 && (styleName.length == name.length || styleName[name.length] == ".")
      if (match && style && name.length > selector.length) cls = styleMod[style]
      if (match && add) addCls += (addCls ? " " : "") + styleMod[add]
    }
    tokenArray.push(cls)
    tokenAddArray.push(addCls)
  }

  let classes = otherStyles.map(({name, style}) => ({name, class: styleMod[style]}))
  return new Theme(styleMod, tokenArray, tokenAddArray.some(s => s) ? tokenAddArray : null, classes)
}

class Theme {
  constructor(readonly styleMod: StyleModule,
              readonly tokenClasses: readonly string[],
              readonly tokenAddClasses: readonly string[] | null,
              readonly rules: readonly {name: string, class: string}[]) {}

  match(query: string) {
    let found = "", selector = ""
    for (let {name, class: cls} of this.rules) {
      if (name.length > selector.length && query.indexOf(name) == 0 &&
          (query.length == name.length || query[name.length] == ".")) {
        found = cls
        selector = name
      }
    }
    return found
  }
}

// FIXME should probably be more generic
export const themeData = EditorView.extend.behavior<Theme>()

export function theme(rules: ThemeSpec) {
  let theme = parseTheme(rules), cache: {[tag: string]: string} = Object.create(null)
  return [
    themeData(theme),
    EditorView.themeClass(str => {
      let value = cache[str]
      return value != null ? value : (cache[str] = theme.match(str))
    }),
    EditorView.styleModule(theme.styleMod)
  ]
}

export const defaultTheme = theme({
  token: {
    keyword: {
      expression: {color: "#219"},
      color: "#708"
    },
    literal: {
      number: {color: "#164"},
      string: {color: "#a11"},
      character: {color: "#a11"},
      regexp: {color: "#e40"},
      escape: {color: "#e40"}
    },
    name: {
      "variable.define": {color: "#00f"},
      type: {color: "#085"},
      "property.define": {color: "#00c"}
    },
    comment: {color: "#940"},
    meta: {color: "#555"},
    invalid: {color: "#f00"}
  },
  bracket: {
    matching: {color: "#0b0"},
    nonmatching: {color: "#a22"}
  }
})

// FIXME export an externalStyleTheme that just adds classes
// corresponding to the style names
