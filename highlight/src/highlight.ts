import {Tag} from "lezer-tree"
import {EditorView, ViewField, Decoration, DecorationSet, DecoratedRange, themeClass, notified} from "../../view/src"
import {Syntax, StateExtension} from "../../state/src/"

class Highlighter {
  deco: DecorationSet

  constructor(readonly syntax: Syntax | null, view: EditorView) {
    this.deco = this.buildDeco(view)
  }

  buildDeco(view: EditorView) {
    let themes = view.behavior.get(themeClass)
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

    let context: Tag[] = [], classes: string[] = [], top = ""
    tree.iterate(from, to, (tag, start) => {
      let add = view.themeClass(tag, context)
      context.push(tag)
      classes.push(top)
      if (add) {
        flush(start, top)
        if (top) top += " "
        top += add
      }
    }, (tag, _, end) => {
      context.pop()
      let prev = classes.pop()!
      if (prev != top) {
        flush(Math.min(to, end), top)
        top = prev
      }
    })
    return Decoration.set(tokens)
  }
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
