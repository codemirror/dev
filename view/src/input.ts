import {MetaSlot} from "../../state/src/state"
import {EditorView} from "./view"
import browser from "./browser"

const uiEvent = new MetaSlot("uiEvent")
const handlers = Object.create(null)

export function attachEventHandlers(view: EditorView) {
  for (let event in handlers) {
    let handler = handlers[event]
    view.contentDOM.addEventListener(event, event => handler(view, event))
  }
}

// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
// FIXME when Mobile Safari fixes this, change this to a version
// range test
const brokenClipboardAPI = (browser.ie && browser.ie_version < 15) || browser.ios

function capturePaste(view: EditorView) {
  let doc = view.dom.ownerDocument
  let target = doc.body.appendChild(doc.createElement("textarea"))
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.focus()
  setTimeout(() => {
    view.focus()
    doc.body.removeChild(target)
    doPaste(view, target.value)
  }, 50)
}

function doPaste(view: EditorView, text: string) {
  // FIXME normalize input text (newlines)?
  view.dispatch(view.state.transaction.replaceSelection(text).setMeta(uiEvent, "paste"))
}

handlers.paste = (view: EditorView, event: ClipboardEvent) => {
  let data = brokenClipboardAPI ? null : event.clipboardData
  let text = data && data.getData("text/plain")
  if (text) {
    doPaste(view, text)
    event.preventDefault()
  } else {
    capturePaste(view)
  }
}

function captureCopy(view: EditorView, text: string) {
  // The extra wrapper is somehow necessary on IE/Edge to prevent the
  // content from being mangled when it is put onto the clipboard
  let doc = view.dom.ownerDocument
  let target = doc.body.appendChild(doc.createElement("textarea"))
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.value = text
  target.focus()
  target.selectionEnd = text.length
  target.selectionStart = 0
  setTimeout(() => {
    doc.body.removeChild(target)
    view.focus()
  }, 50)
}

handlers.copy = handlers.cut = (view: EditorView, event: ClipboardEvent) => {
  let range = view.state.selection.primary
  if (range.empty) return

  let data = brokenClipboardAPI ? null : event.clipboardData
  let text = view.state.doc.slice(range.from, range.to)
  if (data) {
    event.preventDefault()
    data.clearData()
    data.setData("text/plain", text)
  } else {
    captureCopy(view, text)
  }
  if (event.type == "cut") {
    view.dispatch(view.state.transaction.replaceSelection("").scrollIntoView().setMeta(uiEvent, "cut"))
  }
}
