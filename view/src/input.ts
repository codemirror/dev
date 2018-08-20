import {MetaSlot} from "../../state/src"
import {EditorView} from "./editorview"
import browser from "./browser"
import {beforeKeyDown} from "./capturekeys"

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

  constructor(view: EditorView) {
    for (let type in handlers) {
      let handler = handlers[type]
      view.contentDOM.addEventListener(type, event => {
        if (!eventBelongsToEditor(view, event)) return
        if (this.runCustomHandlers(type, view, event)) event.preventDefault()
        else handler(view, event)
      })
      this.registeredEvents.push(type)
    }
    // Must always run, even if a custom handler handled the event
    view.contentDOM.addEventListener("keydown", event => {
      view.inputState.lastKeyCode = event.keyCode
      view.inputState.lastKeyTime = Date.now()
    })
    this.updateCustomHandlers(view)
  }

  updateCustomHandlers(view: EditorView) {
    this.customHandlers = customHandlers(view)
    for (let type in this.customHandlers) {
      if (this.registeredEvents.indexOf(type) < 0) {
        this.registeredEvents.push(type)
        view.contentDOM.addEventListener(type, event => {
          if (!eventBelongsToEditor(view, event)) return
          if (this.runCustomHandlers(type, view, event)) event.preventDefault()
        })
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

function eventBelongsToEditor(view: EditorView, event: Event): boolean {
  if (!event.bubbles) return true
  if (event.defaultPrevented) return false
  for (let node: Node | null = event.target as Node; node != view.contentDOM; node = node.parentNode)
    if (!node || node.nodeType == 11 || (node.cmView && node.cmView.ignoreEvent(event)))
      return false
  return true
}

function customHandlers(view: EditorView) {
  let result = Object.create(null)
  view.someProp("handleDOMEvents", handlers => {
    for (let eventType in handlers)
      (result[eventType] || (result[eventType] = [])).push(handlers[eventType])
  })
  return result
}

const handlers = Object.create(null)

// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
const brokenClipboardAPI = (browser.ie && browser.ie_version < 15) ||
  (browser.ios && browser.webkit_version < 604)

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
  view.dispatch(view.state.transaction.replaceSelection(text).setMeta(MetaSlot.userEvent, "paste").scrollIntoView())
}

handlers.keydown = (view: EditorView, event: KeyboardEvent) => {
  if (beforeKeyDown(view, event)) event.preventDefault()
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

// FIXME add wheel event handlers that predictively adjust the viewport
