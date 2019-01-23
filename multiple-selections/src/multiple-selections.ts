import {EditorState, StateExtension} from "../../state/src"
import {ViewField, styleModule, DecorationSet, Decoration, WidgetType, RangeDecorationSpec} from "../../view/src"
import {StyleModule} from "style-mod"

export interface Config {}

export const multipleSelections = StateExtension.unique((configs: Config[]) => {
  let rangeConfig = {class: styles.secondarySelection} // FIXME configurable?

  return StateExtension.all(
    StateExtension.allowMultipleSelections(true),
    ViewField.decorations({
      create(view) { return decorateSelections(view.state, rangeConfig) },
      update(deco, {prevState, state}) {
        return prevState.doc == state.doc && prevState.selection.eq(state.selection)
          ? deco : decorateSelections(state, rangeConfig)
      },
      map: false
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

function decorateSelections(state: EditorState, rangeConfig: RangeDecorationSpec): DecorationSet {
  let {ranges, primaryIndex} = state.selection
  if (ranges.length == 1) return Decoration.none
  let deco = []
  for (let i = 0; i < ranges.length; i++) if (i != primaryIndex) {
    let range = ranges[i]
    deco.push(range.empty ? Decoration.widget(range.from, {widget: new CursorWidget(null)})
              : Decoration.range(ranges[i].from, ranges[i].to, rangeConfig))
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
