import {MetaSlot} from "../../state/src/state"
import {EditorView} from "./editorview"
import browser from "./browser"

// This will also be where dragging info and such goes
export class InputState {
  lastKeyCode: number = 0
  lastKeyTime: number = 0
  lastSelectionOrigin: string | null = null
  lastSelectionTime: number = 0

  registeredEvents: string[] = []
  customHandlers!: {[key: string]: ((view: EditorView, event: Event) => boolean)[]}

  setSelectionOrigin(origin: string) {
    this.lastSelectionOrigin = origin
    this.lastSelectionTime = Date.now()
  }

  // FIXME check whether event belongs to actual editor

  constructor(view: EditorView) {
    for (let type in handlers) {
      let handler = handlers[type]
      view.contentDOM.addEventListener(type, event => {
        this.runCustomHandlers(type, view, event) || handler(view, event)
      })
      this.registeredEvents.push(type)
    }
    this.updateCustomHandlers(view)
  }

  updateCustomHandlers(view: EditorView) {
    this.customHandlers = customHandlers(view)
    for (let type in this.customHandlers) {
      if (this.registeredEvents.indexOf(type) < 0) {
        this.registeredEvents.push(type)
        view.contentDOM.addEventListener(type, event => this.runCustomHandlers(type, view, event))
      }
    }
  }

  runCustomHandlers(type: string, view: EditorView, event: Event): boolean {
    let handlers = this.customHandlers[type]
    if (handlers) for (let handler of handlers)
      if (handler(view, event) || event.defaultPrevented) return true
    return false
  }
}

const handlers = Object.create(null)

function customHandlers(view: EditorView) {
  let result = Object.create(null)
  view.someProp("handleDOMEvents", handlers => {
    for (let eventType in handlers)
      (result[eventType] || (result[eventType] = [])).push(handlers[eventType])
  })
  return result
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
  view.dispatch(view.state.transaction.replaceSelection(text).setMeta(MetaSlot.userEvent, "paste"))
}

handlers.keydown = (view: EditorView, event: KeyboardEvent) => {
  view.inputState.lastKeyCode = event.keyCode
  view.inputState.lastKeyTime = Date.now()
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
    view.dispatch(view.state.transaction.replaceSelection("").scrollIntoView().setMeta(MetaSlot.userEvent, "cut"))
  }
}
