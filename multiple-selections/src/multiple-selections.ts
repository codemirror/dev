import {EditorState} from "../../state/src"
import {ViewPlugin, styleModule, DecorationSet, Decoration, WidgetType, MarkDecorationSpec} from "../../view/src"
import {Extension} from "../../extension/src/extension"
import {StyleModule} from "style-mod"

export interface Config {}

export const multipleSelections = EditorState.extend.unique((configs: Config[]) => {
  let rangeConfig = {class: styles.secondarySelection} // FIXME configurable?

  return Extension.all(
    EditorState.allowMultipleSelections(true),
    ViewPlugin.decorate({
      create(view) { return decorateSelections(view.state, rangeConfig) },
      update(deco, {prevState, state}) {
        return prevState.doc == state.doc && prevState.selection.eq(state.selection)
          ? deco : decorateSelections(state, rangeConfig)
      }
    }),
    styleModule(styles)
  )
}, {})

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
