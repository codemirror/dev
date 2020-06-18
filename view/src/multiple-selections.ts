import {DecorationSet, Decoration, WidgetType} from "./decoration"
import {EditorView} from "./editorview"
import {themeClass} from "./theme"
import {EditorState, StateField, EditorSelection, Extension} from "@codemirror/next/state"

const field = StateField.define<DecorationSet>({
  create(state) {
    return decorateSelections(state.selection)
  },
  update(deco, tr) {
    return tr.docChanged || tr.selection ? decorateSelections(tr.state.selection) : deco
  },
  provide: [EditorView.decorations]
})

/// Returns an extension that enables multiple selections for the
/// editor. Secondary cursors and selected ranges are drawn with
/// simple decorations, and might not look the same as the primary
/// native selection.
export function multipleSelections(): Extension {
  return [
    EditorState.allowMultipleSelections.of(true),
    field
  ]
}

class CursorWidget extends WidgetType<null> {
  toDOM() {
    let span = document.createElement("span")
    span.className = themeClass("secondaryCursor")
    return span
  }

  static deco = Decoration.widget({widget: new CursorWidget(null)})
}

const rangeMark = Decoration.mark({class: themeClass("secondarySelection")})

function decorateSelections(selection: EditorSelection): DecorationSet {
  let {ranges, primaryIndex} = selection
  if (ranges.length == 1) return Decoration.none
  let deco = []
  for (let i = 0; i < ranges.length; i++) if (i != primaryIndex) {
    let range = ranges[i]
    deco.push(range.empty ? CursorWidget.deco.range(range.from) : rangeMark.range(ranges[i].from, ranges[i].to))
  }
  return Decoration.set(deco)
}
