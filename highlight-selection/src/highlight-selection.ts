import {EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, themeClass} from "@codemirror/next/view"
//import {SearchCursor} from "@codemirrror/next/search"

/// Mark lines that have a cursor on them with the \`activeline\`
/// theme selector.
export function highlightActiveLine() {
  return [defaultTheme, activeLineHighlighter]
}

const lineDeco = Decoration.line({attributes: {class: themeClass("activeline")}})

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
      let line = view.lineAt(r.head, 0)
      if (line.from > lastLineStart) {
        deco.push(lineDeco.range(line.from))
        lastLineStart = line.from
      }
    }
    return Decoration.set(deco)
  }
}).decorations()

const defaultTheme = EditorView.baseTheme({
  "activeline": {
    background: "#e8f2ff"
  }
})
