import {EditorView, ViewField, Decoration, DecoratedRange} from "../../view/src"
import {syntaxTree} from "../../syntax/src/syntax"

function highlightDeco(view: EditorView) {
  let {from, to} = view.viewport
  let found = syntaxTree(view.state, from, to)
  if (!found) return Decoration.none

  let tokens: DecoratedRange[] = []
  let {syntax, tree} = found
  let cur: string | null = null, start = from
  // FIXME this is broken and crude
  tree.iterate(from, to, 0, (tag, a, b) => {
    let type = syntax.tokenTypes.get(tag)
    if (type != cur) {
      if (a > start && cur) tokens.push(Decoration.mark(start, a, {class: "cm-" + cur}))
      cur = type
      start = Math.max(from, a)
    }
    return true
  }, (_, a, b) => {
    if (b > start && cur) tokens.push(Decoration.mark(start, Math.min(b, to), {class: "cm-" + cur}))
    cur = null
    start = b
  })
  return Decoration.set(tokens)
}

export function highlight() {
  return ViewField.decorations({
    create(view) { return highlightDeco(view) },
    update(old, update) { return update.docChanged ? highlightDeco(update.view) : old }
  })
}
