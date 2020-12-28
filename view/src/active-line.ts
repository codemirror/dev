import {Extension} from "@codemirror/next/state"
import {EditorView} from "./editorview"
import {ViewPlugin, ViewUpdate} from "./extension"
import {Decoration, DecorationSet} from "./decoration"
import {themeClass} from "./theme"

/// Mark lines that have a cursor on them with the `$activeLine`
/// theme class.
export function highlightActiveLine(): Extension {
  return activeLineHighlighter
}

const lineDeco = Decoration.line({attributes: {class: themeClass("activeLine")}})

const activeLineHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.getDeco(view)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) this.decorations = this.getDeco(update.view)
  }

  getDeco(view: EditorView) {
    let lastLineStart = -1, deco = []
    for (let r of view.state.selection.ranges) {
      if (!r.empty) continue
      let line = view.visualLineAt(r.head)
      if (line.from > lastLineStart) {
        deco.push(lineDeco.range(line.from))
        lastLineStart = line.from
      }
    }
    return Decoration.set(deco)
  }
}, {
  decorations: v => v.decorations
})
