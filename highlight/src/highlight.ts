import {TagMap} from "lezer"
import {EditorView, ViewField, Decoration, DecorationSet, DecoratedRange, themeClass, notified} from "../../view/src"
import {Slot} from "../../extension/src/extension"
import {Syntax, syntax} from "../../syntax/src/syntax"

export const tokenTypes = Slot.define<TagMap<string>>()

class Set {
  [next: string]: TokenContext
}
Set.prototype = Object.create(null)

class TokenContext {
  cached = new Set

  constructor(readonly type: string, readonly style: string, readonly prev: TokenContext | null) {}

  enter(type: string, themes: readonly ((type: string) => string)[]) {
    let found = this.cached[type]
    if (!found) {
      let fullType = "token." + type + "." + this.type
      let classes = ""
      for (let theme of themes) {
        let value = theme(fullType)
        if (value) classes += (classes ? " " + value : value)
      }
      found = this.cached[type] = new TokenContext(fullType, classes, this)
    }
    return found
  }

  static start(type: string) {
    return new TokenContext(type, "", null)
  }
}

class Highlighter {
  deco: DecorationSet
  baseContext: TokenContext

  constructor(readonly syntax: Syntax | null, view: EditorView) {
    this.baseContext = TokenContext.start("syntax:" + (syntax ? syntax.name : "null"))
    this.deco = this.buildDeco(view)
  }

  buildDeco(view: EditorView) {
    let themes = view.behavior.get(themeClass)
    if (!this.syntax || themes.length == 0) return Decoration.none

    let {from, to} = view.viewport
    let tree = this.syntax.tryGetTree(view.state, from, to, view.notify)

    let tokens: DecoratedRange[] = []
    let tokenMap = this.syntax.getSlot(tokenTypes)!
    let context = this.baseContext
    let cur = "", start = from
    function flush(pos: number, style: string) {
      if (style == cur) return
      if (pos > start && cur)
        tokens.push(Decoration.mark(start, pos, {class: cur}))
      start = pos
      cur = style
    }

    tree.iterate(from, to, (type, start) => {
      let tokType = tokenMap.get(type)
      if (tokType != null) {
        context = context.enter(tokType, themes)
        flush(start, context.style)
      }
    }, (type, _, end) => {
      let tokType = tokenMap.get(type)
      if (tokType != null) {
        context = context.prev!
        flush(end, context.style)
      }
    })
    return Decoration.set(tokens)
  }
}

export function highlight() { // FIXME allow specifying syntax?
  return new ViewField<Highlighter>({
    create(view) {
      for (let s of view.state.behavior.get(syntax))
        if (s.getSlot(tokenTypes)) return new Highlighter(s, view)
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
