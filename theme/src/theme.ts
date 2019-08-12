import {StyleModule, Style} from "style-mod"
import {ViewExtension, styleModule, themeClass, EditorView, ViewField, Decoration, DecorationSet, DecoratedRange, notified} from "../../view/src"
import {Tag, TagMatch, TagMatchSpec} from "lezer-tree"
import {Syntax, StateExtension} from "../../state/src/"

function mapSpec<A, B>(spec: TagMatchSpec<A>, f: (a: A) => B): TagMatchSpec<B> {
  let result: {[name: string]: B | TagMatchSpec<B>} = {}
  for (let prop in spec)
    result[prop] = /^\./.test(prop) ? mapSpec(spec[prop] as TagMatchSpec<A>, f) : f(spec[prop] as A)
  return result
}

class Theme {
  constructor(readonly styleMod: StyleModule,
              readonly match: TagMatch<string>,
              readonly cover: readonly string[]) {}
}

function parseTheme(rules: TagMatchSpec<Style>) {
  let styleObj: {[name: string]: Style} = {}, classID = 1
  let coverNames: string[] = []
  let toClassName = mapSpec(rules, (style: Style) => {
    let name = "c" + (classID++)
    if (style.coverChildren) coverNames.push(name)
    if (style.coverChildren !== undefined) {
      let copy: Style = {}
      for (let prop in style) if (prop != "coverChildren") copy[prop] = style[prop]
      style = copy
    }
    styleObj[name] = style
    return name
  })
  let styles = new StyleModule(styleObj)
  return new Theme(styles,
                   new TagMatch(mapSpec(toClassName, name => styles[name])),
                   coverNames.map(name => styles[name]))
}

const themeData = ViewExtension.defineBehavior<Theme>()

export function theme(rules: TagMatchSpec<Style>) {
  let theme = parseTheme(rules), cache: {[tag: string]: string} = Object.create(null)
  return ViewExtension.all(
    themeData(theme),
    themeClass(str => {
      let value = cache[str]
      return value != null ? value : (cache[str] = theme.match.best(new Tag(str)) || "")
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

    // Stack of parent nodes
    let parents: Tag[] = []
    // The current node's own style and child-covering styles.
    let curClass = "", curCover = ""
    // We need to keep some kind of information to be able to return
    // back to a parent node's style. But because most styling happens
    // on leaf nodes, this is optimized by only tracking context if
    // there is any—that is, if any parent node is styled.
    let tokenContext: TokenContext | null = null
    tree.iterate(from, to, ({tag}, start) => {
      let cls = curCover, cover = curCover
      for (let theme of themes) {
        let val = theme.match.best(tag, parents)
        if (val) {
          if (cls) cls += " "
          cls += val
          if (theme.cover.includes(val)) {
            if (cover) cover += " "
            cover += val
          }
        }
      }
      if (curClass || tokenContext) {
        tokenContext = new TokenContext(curClass, curCover, tokenContext)
        if (curClass != cls) {
          flush(start, curClass)
          curClass = cls
        }
        curCover = cover
      } else if (cls) {
        flush(start, curClass)
        curClass = cls
        curCover = cover
      }
      parents.push(tag)
    }, ({tag}, _, end) => {
      parents.pop()
      if (tokenContext) {
        if (tokenContext.cls != curClass) flush(Math.min(to, end), curClass)
        curClass = tokenContext.cls
        curCover = tokenContext.cover
        tokenContext = tokenContext.parent
      } else if (curClass) {
        flush(Math.min(to, end), curClass)
        curClass = curCover = ""
      }
    })
    return Decoration.set(tokens)
  }
}

class TokenContext {
  constructor(readonly cls: string,
              readonly cover: string,
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
  "keyword": {color: "#708"},
  ".expression": {
    "keyword, literal": {color: "#219"},
    ".literal": {
      "number": {color: "#164"},
      "string": {color: "#a11"},
      "regexp": {color: "#e40"}
    }
  },
  ".name": {
    "variable.definition": {color: "#00f"},
    "type": {color: "#085"},
    "definition.property": {color: "#00c"}
  },
  "comment": {color: "#940"},
  "metadata": {color: "#555"},
  "error": {color: "#f00"},

  ".bracket": {
    "matching": {color: "#0b0"},
    "nonmatching": {color: "#a22"}
  }
})
