import {TagMap} from "lezer"
import {EditorView, ViewField, Decoration, DecorationSet, DecoratedRange} from "../../view/src"
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

  enter(type: string, theme: (type: string) => string) {
    let found = this.cached[type]
    if (!found) {
      let fullType = type + "." + this.type
      found = this.cached[type] = new TokenContext(fullType, theme(fullType), this)
    }
    return found
  }

  static start(type: string) {
    return new TokenContext(type, "", null)
  }
}

// FIXME replace with actual theming system
let theme = (type: string) => {
  let parts = type.split(".")
  for (let i = parts.length - 1; i >= 0; i--) {
    let part = parts[i]
    if (part == "meta") return "cm-meta"
    if (part == "keyword") return "cm-keyword"
    if (part == "string") return "cm-string"
    if (part == "number") return "cm-number"
  }
  return ""
}

class Highlighter {
  deco: DecorationSet
  baseContext: TokenContext

  constructor(readonly syntax: Syntax | null, view: EditorView) {
    this.baseContext = TokenContext.start("syntax:" + (syntax ? syntax.name : "null"))
    this.deco = this.buildDeco(view)
  }

  buildDeco(view: EditorView) {
    if (!this.syntax) return Decoration.none

    let {from, to} = view.viewport
    let tree = this.syntax.getTree(view.state, from, to)

    let tokens: DecoratedRange[] = []
    let tokenMap = this.syntax.getSlot(tokenTypes)!
    let context = this.baseContext
    let cur = "", start = from
    function advance(pos: number, type: string) {
      if (type == cur) return
      if (pos > start && cur) tokens.push(Decoration.mark(start, pos, {class: cur}))
      start = pos
      cur = type
    }

    tree.iterate(from, to, 0, (tag, start) => {
      let type = tokenMap!.get(tag)
      if (type != null) {
        context = context.enter(type, theme)
        advance(start, context.style)
      }
      return true // FIXME drop this requirement
    }, (tag, _, end) => {
      let type = tokenMap!.get(tag)
      if (type != null) {
        advance(end, context.style)
        context = context.prev!
      }
      return true
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
      if (update.docChanged) highlighter.deco = highlighter.buildDeco(update.view)
      return highlighter // FIXME immutable?
    },
    effects: [ViewField.decorationEffect(h => h.deco)]
  }).extension
}
