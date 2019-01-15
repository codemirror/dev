import {EditorState, StateExtension} from "../../state/src"
import {ViewExtension, DecorationSet, Decoration, WidgetType, RangeDecorationSpec} from "../../view/src"

export interface Config {}

export const multipleSelections = StateExtension.unique((configs: Config[]) => {
  let rangeConfig = {class: "CodeMirror-secondary-selection"} // FIXME configurable?

  return StateExtension.all(
    StateExtension.allowMultipleSelections(true),
    ViewExtension.decorations({
      create(view) { return decorateSelections(view.state, rangeConfig) },
      update(_view, {oldState, state}, deco) {
        return oldState.doc == state.doc && oldState.selection.eq(state.selection)
          ? deco : decorateSelections(state, rangeConfig)
      },
      map: false
    })
  )
}, {})

class CursorWidget extends WidgetType<null> {
  toDOM() {
    let span = document.createElement("span")
    span.className = "CodeMirror-secondary-cursor"
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
