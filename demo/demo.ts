import {Text} from "../doc/src/text"
import {EditorState, Configuration} from "../state/src/state"
import {EditorView} from "../view/src/view"

let state = new EditorState(Configuration.default, Text.create("one\ntwo\nthree"))
let view = window.view = new EditorView(state)
document.body.appendChild(view.dom)
