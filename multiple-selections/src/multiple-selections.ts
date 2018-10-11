import {Plugin, EditorState} from "../../state/src"
import {EditorView, DecorationSet, Decoration, WidgetType, RangeDecorationSpec, PointDecorationSpec} from "../../view/src"

export function multipleSelections() {
  return new Plugin({
    multipleSelections: true,
    view: (view: EditorView) => new MultipleSelectionView(view)
  })
}

class CursorWidget extends WidgetType<null> {
  toDOM() {
    let span = document.createElement("span")
    span.className = "CodeMirror-secondary-cursor"
    return span
  }
}

class MultipleSelectionView {
  decorations: DecorationSet = Decoration.none
  rangeConfig: RangeDecorationSpec

  constructor(view: EditorView) {
    this.update(view.state)
    this.rangeConfig = {class: "CodeMirror-secondary-selection"} // FIXME configurable?
  }

  updateState(view: EditorView, prevState: EditorState) {
    if (prevState.doc != view.state.doc || !prevState.selection.eq(view.state.selection))
      this.update(view.state)
  }

  update(state: EditorState) {
    let {ranges, primaryIndex} = state.selection
    if (ranges.length == 0) {
      this.decorations = Decoration.none
      return
    }
    let deco = []
    for (let i = 0; i < ranges.length; i++) if (i != primaryIndex) {
      let range = ranges[i]
      deco.push(range.empty ? Decoration.widget(range.from, new CursorWidget(null)) : Decoration.range(ranges[i].from, ranges[i].to, this.rangeConfig))
    }
    this.decorations = Decoration.set(deco)
  }
}
