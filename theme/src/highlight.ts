import {EditorView, ViewField, Decoration, DecorationSet, DecoratedRange} from "../../view/src"
import {themeData} from "./theme"
import {Syntax, EditorState} from "../../state/src/"
import {styleNodeProp} from "./styleprop"

class Highlighter {
  deco!: DecorationSet
  partialDeco = false

  constructor(readonly syntax: Syntax | null, view: EditorView) {
    this.buildDeco(view)
  }

  buildDeco(view: EditorView) {
    let themes = view.behavior.get(themeData)
    if (!this.syntax || themes.length == 0) {
      this.deco = Decoration.none
      return
    }

    let {from, to} = view.viewport
    let {tree, rest} = this.syntax.getTree(view.state, from, to)
    this.partialDeco = !rest
    if (rest) view.waitFor(rest)

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
    tree.iterate(from, to, (type, start) => {
      let cls = curAdd, add = curAdd
      let style = type.prop(styleNodeProp)
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
    this.deco = Decoration.set(tokens)
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
      for (let s of view.state.behavior.get(EditorState.syntax))
        return new Highlighter(s, view)
      return new Highlighter(null, view)
    },
    update(highlighter, update) {
      if (highlighter.partialDeco || update.docChanged || update.viewportChanged)
        highlighter.buildDeco(update.view)
      return highlighter // FIXME immutable?
    },
    effects: [ViewField.decorationEffect(h => h.deco)]
  }).extension
}

