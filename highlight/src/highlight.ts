import {TagMap} from "lezer"
import {EditorView, ViewField, Decoration, DecoratedRange} from "../../view/src"
import {Slot} from "../../extension/src/extension"
import {syntax} from "../../syntax/src/syntax"

export const tokenTypes = Slot.define<TagMap<string>>()

class Set {
  [next: string]: TokenContext
}
Set.prototype = Object.create(null)

class TokenContext {
  cached = new Set

  constructor(readonly type: readonly string[], readonly style: string, readonly prev: TokenContext | null) {}

  enter(type: string, theme: (type: readonly string[]) => string) {
    let found = this.cached[type]
    if (!found) {
      let fullType = this.type.concat(type.split("."))
      found = this.cached[type] = new TokenContext(fullType, theme(fullType), this)
    }
    return found
  }

  static start(type: string) {
    return new TokenContext(type.split("."), "", null)
  }
}

// FIXME replace with actual theming system
let theme = (type: readonly string[]) => {
  for (let i = type.length - 1; i >= 0; i--) {
    let part = type[i]
    if (part == "meta") return "cm-meta"
    if (part == "keyword") return "cm-keyword"
    if (part == "string") return "cm-string"
    if (part == "number") return "cm-number"
  }
  return ""
}

function highlightDeco(view: EditorView) {
  let syntaxes = view.state.behavior.get(syntax)
  let tokenMap: TagMap<string> | null = null, syn = null
  for (let s of syntaxes) {
    if (tokenMap = s.getSlot(tokenTypes)) { syn = s; break }
  }
  if (!syn) return Decoration.none

  let {from, to} = view.viewport
  let tree = syn.getTree(view.state, from, to)

  let tokens: DecoratedRange[] = []
  let context = TokenContext.start("javascript")
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
    return true
  }, (tag, _, end) => {
    let type = tokenMap!.get(tag)
    if (type != null) {
      advance(end, context.style)
      context = context.prev!
      console.log("leave", type, context.style)
    }
    return true
  })
  return Decoration.set(tokens)
}

export function highlight() {
  return ViewField.decorations({
    create(view) { return highlightDeco(view) },
    update(old, update) { return update.docChanged ? highlightDeco(update.view) : old }
  })
}
