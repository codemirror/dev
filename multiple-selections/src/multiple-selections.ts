import {EditorState} from "../../state"
import {ViewPlugin, DecorationSet, Decoration, WidgetType, EditorView, MarkDecorationSpec} from "../../view"
import {StyleModule} from "style-mod"

const styles = new StyleModule({
  secondarySelection: {
    backgroundColor_fallback: "#3297FD",
    color_fallback: "white !important",
    backgroundColor: "Highlight",
    color: "HighlightText !important"
  },

  secondaryCursor: {
    display: "inline-block",
    verticalAlign: "text-top",
    borderLeft: "1px solid #555",
    width: 0,
    height: "1.15em",
    margin: "0 -0.5px -.5em"
  }
})

const rangeConfig = {class: styles.secondarySelection}

const multipleSelectionExtension = [
  EditorState.allowMultipleSelections(true),
  ViewPlugin.decoration({
    create(view) { return decorateSelections(view.state, rangeConfig) },
    update(deco, {prevState, state}) {
      return prevState.doc == state.doc && prevState.selection.eq(state.selection)
        ? deco : decorateSelections(state, rangeConfig)
    }
  }),
  EditorView.styleModule(styles)
]

/// Returns an extension that enables multiple selections for the
/// editor. Secondary cursors and selected ranges are drawn with
/// simple decorations, and might look the same as the primary native
/// selection.
export function multipleSelections() {
  return multipleSelectionExtension
}

class CursorWidget extends WidgetType<null> {
  toDOM() {
    let span = document.createElement("span")
    span.className = styles.secondaryCursor
    return span
  }
}

function decorateSelections(state: EditorState, rangeConfig: MarkDecorationSpec): DecorationSet {
  let {ranges, primaryIndex} = state.selection
  if (ranges.length == 1) return Decoration.none
  let deco = []
  for (let i = 0; i < ranges.length; i++) if (i != primaryIndex) {
    let range = ranges[i]
    deco.push(range.empty ? Decoration.widget(range.from, {widget: new CursorWidget(null)})
              : Decoration.mark(ranges[i].from, ranges[i].to, rangeConfig))
  }
  return Decoration.set(deco)
}
