import {EditorState} from "../state/src/state"
import {EditorView, Decoration, DecorationSet} from "../view/src/view"

let state = EditorState.create({doc: "one\ntwo\nthree"})
let view = window.view = new EditorView(state, {
  decorations() { return DecorationSet.of(Decoration.range(0, 2, {attributes: {style: "color: red"}})) }
})
document.body.appendChild(view.dom)
