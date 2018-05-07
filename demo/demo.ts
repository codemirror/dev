import {EditorState} from "../state/src/state"
import {EditorView} from "../view/src/view"

let state = EditorState.create({doc: "one\ntwo\nthree"})
let view = window.view = new EditorView(state)
document.body.appendChild(view.dom)
