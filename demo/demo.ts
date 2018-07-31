import {EditorState, Plugin, StateField} from "../state/src"
import {EditorView, Decoration, DecorationSet} from "../view/src/"
import {keymap} from "../keymap/src/keymap"
import {history, redo, undo} from "../history/src/history"
import {gutter} from "../gutter/src/index"

let field = new StateField<DecorationSet>({
  init() {return Decoration.set([
    Decoration.range(0, 2, {attributes: {style: "color: red"}, inclusiveEnd: true}),
    Decoration.range(4, 5, {attributes: {style: "color: blue"}, inclusiveStart: true}),
    Decoration.range(9, 12, {attributes: {style: "color: orange"}})
  ])},
  apply(tr, decos) { return decos.map(tr.changes) }
})
let decos = new Plugin({
  state: field,
  props: {
    decorations(state) { return state.getField(field) }
  }
})

let state = EditorState.create({doc: "one\ntwo\nthree\n".repeat(200), plugins: [history(), decos, gutter(), keymap({
  "ctrl-z": undo,
  "ctrl-shift-z": redo
})]})
let view = (window as any).view = new EditorView(state)
document.querySelector("#editor").appendChild(view.dom)
