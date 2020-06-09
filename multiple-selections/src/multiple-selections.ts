import {EditorState, StateField, EditorSelection, Extension} from "@codemirror/next/state"
import {DecorationSet, Decoration, WidgetType, EditorView, themeClass} from "@codemirror/next/view"

const field = StateField.define<DecorationSet>({
  create(state) {
    return decorateSelections(state.selection)
  },
  update(deco, tr, state) {
    return tr.docChanged || tr.selection ? decorateSelections(state.selection) : deco
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
    width: 0,
    height: "1.15em",
    margin: "0 -0.7px -.7em"
  },

  "secondaryCursor@light": { borderLeft: "1.4px solid #555" },
  "secondaryCursor@dark": { borderLeft: "1.4px solid #ddd" }
})
