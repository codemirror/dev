import {EditorState, StateField, EditorSelection} from "../../state"
import {DecorationSet, Decoration, WidgetType, EditorView, MarkDecorationSpec, themeClass} from "../../view"

const rangeConfig = {class: themeClass("secondarySelection")}

const field = StateField.define<DecorationSet>({
  create(state) {
    return decorateSelections(state.selection, rangeConfig)
  },
  update(deco, tr) {
    return tr.docChanged || tr.selectionSet ? decorateSelections(tr.selection, rangeConfig) : deco
  }
}).provide(EditorView.decorations)

/// Returns an extension that enables multiple selections for the
/// editor. Secondary cursors and selected ranges are drawn with
/// simple decorations, and might not look the same as the primary
/// native selection.
export function multipleSelections() {
  return [
    EditorState.allowMultipleSelections.of(true),
    field,
    styles
  ]
}

class CursorWidget extends WidgetType<null> {
  toDOM() {
    let span = document.createElement("span")
    span.className = themeClass("secondaryCursor")
    return span
  }
}

function decorateSelections(selection: EditorSelection, rangeConfig: MarkDecorationSpec): DecorationSet {
  let {ranges, primaryIndex} = selection
  if (ranges.length == 1) return Decoration.none
  let deco = []
  for (let i = 0; i < ranges.length; i++) if (i != primaryIndex) {
    let range = ranges[i]
    deco.push(range.empty ? Decoration.widget(range.from, {widget: new CursorWidget(null)})
              : Decoration.mark(ranges[i].from, ranges[i].to, rangeConfig))
  }
  return Decoration.set(deco)
}

const styles = EditorView.baseTheme({
  secondarySelection: {
    backgroundColor_fallback: "#3297FD",
    color_fallback: "white !important",
    backgroundColor: "Highlight",
    color: "HighlightText !important"
  },

  secondaryCursor: {
    display: "inline-block",
    verticalAlign: "text-top",
    borderLeft: "1.4px solid #555",
    width: 0,
    height: "1.15em",
    margin: "0 -0.7px -.7em"
  }
})
