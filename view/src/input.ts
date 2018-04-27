import {EditorView} from "./view"

const handlers = Object.create(null)

export function attachEventHandlers(view: EditorView) {
  for (let event in handlers) {
    let handler = handlers[event]
    view.dom.addEventListener(event, event => handler(view, event))
  }
}
