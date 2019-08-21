import {StyleModule, Style} from "style-mod"
import {ViewExtension, styleModule, themeClass, EditorView, ViewField, Decoration, DecorationSet, DecoratedRange, notified} from "../../view/src"
import {NodeProp, StyleNames} from "lezer-tree"
import {Syntax, StateExtension} from "../../state/src/"

type ThemeSpec = {[prop: string]: string | number | ThemeSpec}

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

const themeData = ViewExtension.defineBehavior<Theme>()

export function theme(rules: ThemeSpec) {
  let theme = parseTheme(rules), cache: {[tag: string]: string} = Object.create(null)
  return ViewExtension.all(
    themeData(theme),
    themeClass(str => {
      let value = cache[str]
      return value != null ? value : (cache[str] = theme.match(str))
    }),
    styleModule(theme.styleMod)
  )
}

class Highlighter {
  deco: DecorationSet

  constructor(readonly syntax: Syntax | null, view: EditorView) {
    this.deco = this.buildDeco(view)
  }

  buildDeco(view: EditorView) {
    let themes = view.behavior.get(themeData)
    if (!this.syntax || themes.length == 0) return Decoration.none

    let {from, to} = view.viewport
    let tree = this.syntax.tryGetTree(view.state, from, to, view.notify)

    let tokens: DecoratedRange[] = []
    let start = from
    function flush(pos: number, style: string) {
      if (pos > start && style)
        tokens.push(Decoration.mark(start, pos, {class: style}))
      start = pos
    }

    // The current node's own classes and adding classes.
    let curClass = "", curAdd = ""
    // We need to keep some kind of information to be able to return
    // back to a parent node's style. But because most styling happens
    // on leaf nodes, this is optimized by only tracking context if
    // there is any—that is, if any parent node is styled.
    let tokenContext: TokenContext | null = null
    let styleProp = NodeProp.style
    tree.iterate(from, to, (type, start) => {
      let cls = curAdd, add = curAdd
      let style = type.prop(styleProp)
      if (style != null) for (let theme of themes) {
        let val
        if (val = theme.tokenClasses[style]) {
          if (cls) cls += " "
          cls += val
        }
        if (theme.tokenAddClasses && (val = theme.tokenAddClasses[style])) {
          if (cls) cls += " "
          cls += val
          if (add) add += " "
          add += val
        }
      }
      if (curClass || tokenContext) {
        tokenContext = new TokenContext(curClass, curAdd, tokenContext)
        if (curClass != cls) {
          flush(start, curClass)
          curClass = cls
        }
        curAdd = add
      } else if (cls) {
        flush(start, curClass)
        curClass = cls
        curAdd = add
      }
    }, (_t, _s, end) => {
      if (tokenContext) {
        if (tokenContext.cls != curClass) flush(Math.min(to, end), curClass)
        curClass = tokenContext.cls
        curAdd = tokenContext.add
        tokenContext = tokenContext.parent
      } else if (curClass) {
        flush(Math.min(to, end), curClass)
        curClass = curAdd = ""
      }
    })
    return Decoration.set(tokens)
  }
}

class TokenContext {
  constructor(readonly cls: string,
              readonly add: string,
              readonly parent: TokenContext | null) {}
}

export function highlight() { // FIXME allow specifying syntax?
  return new ViewField<Highlighter>({
    create(view) {
      for (let s of view.state.behavior.get(StateExtension.syntax))
        return new Highlighter(s, view)
      return new Highlighter(null, view)
    },
    update(highlighter, update) {
      if (update.docChanged || update.viewportChanged || update.getMeta(notified))
        highlighter.deco = highlighter.buildDeco(update.view)
      return highlighter // FIXME immutable?
    },
    effects: [ViewField.decorationEffect(h => h.deco)]
  }).extension
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
