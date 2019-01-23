import {EditorSelection, SelectionRange, Transaction, ChangeSet, Change} from "../../state/src"
import {EditorView} from "./editorview"
import {focusChange, handleDOMEvents} from "./extension"
import browser from "./browser"
import {LineContext} from "./cursor"

// This will also be where dragging info and such goes
export class InputState {
  lastKeyCode: number = 0
  lastKeyTime: number = 0
  lastSelectionOrigin: string | null = null
  lastSelectionTime: number = 0

  registeredEvents: string[] = []
  customHandlers: {[key: string]: ((view: EditorView, event: Event) => boolean)[]}

  goalColumns: {pos: number, column: number}[] = []

  mouseSelection: MouseSelection | null = null

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
    if (view.root.activeElement == view.contentDOM) view.dom.classList.add("codemirror-focused")

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

  startMouseSelection(view: EditorView, event: MouseEvent, update: MouseSelectionUpdate) {
    if (this.mouseSelection) this.mouseSelection.destroy()
    this.mouseSelection = new MouseSelection(this, view, event, update)
  }

  update(transactions: Transaction[]) {
    if (this.mouseSelection)
      this.mouseSelection.map(transactions.reduce((set, tr) => set.appendSet(tr.changes), ChangeSet.empty))
    this.lastKeyCode = this.lastSelectionTime = 0
  }

  destroy() {
    if (this.mouseSelection) this.mouseSelection.destroy()
  }
}

export type MouseSelectionUpdate = (view: EditorView, startSelection: EditorSelection,
                                    startPos: number, startBias: -1 | 1,
                                    curPos: number, curBias: -1 | 1,
                                    extend: boolean, multiple: boolean) => EditorSelection

class MouseSelection {
  dragging: null | false | SelectionRange
  startSelection: EditorSelection
  startPos: number
  startBias: -1 | 1
  curPos: number
  curBias: -1 | 1
  extend: boolean
  multiple: boolean
  dragMove: boolean

  constructor(private inputState: InputState, private view: EditorView, event: MouseEvent,
              private update: MouseSelectionUpdate) {
    let doc = view.contentDOM.ownerDocument!
    doc.addEventListener("mousemove", this.move = this.move.bind(this))
    doc.addEventListener("mouseup", this.up = this.up.bind(this))

    // FIXME make these configurable somehow
    this.extend = event.shiftKey
    this.multiple = view.state.multipleSelections && (browser.mac ? event.metaKey : event.ctrlKey)
    this.dragMove = !(browser.mac ? event.altKey : event.ctrlKey)

    this.startSelection = view.state.selection
    let {pos, bias} = this.queryPos(event)
    this.startPos = this.curPos = pos
    this.startBias = this.curBias = bias
    this.dragging = isInPrimarySelection(view, this.startPos, event) ? null : false
    // When clicking outside of the selection, immediately apply the
    // effect of starting the selection
    if (this.dragging === false) {
      event.preventDefault()
      this.select()
    }
  }

  queryPos(event: MouseEvent): {pos: number, bias: 1 | -1} {
    let pos = this.view.posAtCoords({x: event.clientX, y: event.clientY})
    let coords = this.view.coordsAtPos(pos)
    let bias: 1 | -1 = !coords ? 1 :
      coords.top > event.clientY ? -1 :
      coords.bottom < event.clientY ? 1 :
      coords.left > event.clientX ? -1 : 1
    return {pos, bias}
  }

  move(event: MouseEvent) {
    if (event.buttons == 0) return this.destroy()
    if (this.dragging !== false) return
    let {pos, bias} = this.queryPos(event)
    if (pos == this.curPos && bias == this.curBias) return
    this.curPos = pos; this.curBias = bias
    this.select()
  }

  up(event: MouseEvent) {
    if (this.dragging == null) this.select()
    this.destroy()
  }

  destroy() {
    let doc = this.view.contentDOM.ownerDocument!
    doc.removeEventListener("mousemove", this.move)
    doc.removeEventListener("mouseup", this.up)
    this.inputState.mouseSelection = null
  }

  select() {
    let selection = this.update(this.view, this.startSelection, this.startPos, this.startBias,
                                this.curPos, this.curBias, this.extend, this.multiple)
    if (!selection.eq(this.view.state.selection))
      this.view.dispatch(this.view.state.transaction.setSelection(selection)
                         .addMeta(Transaction.userEvent("pointer")))
  }

  map(changes: ChangeSet) {
    if (changes.length) {
      this.startSelection = this.startSelection.map(changes)
      this.startPos = changes.mapPos(this.startPos)
      this.curPos = changes.mapPos(this.curPos)
    }
    if (this.dragging) this.dragging = this.dragging.map(changes)
  }
}

function isInPrimarySelection(view: EditorView, pos: number, event: MouseEvent) {
  let {primary} = view.state.selection
  if (primary.empty) return false
  if (pos < primary.from || pos > primary.to) return false
  if (pos > primary.from && pos < primary.to) return true
  // On boundary clicks, check whether the coordinates are inside the
  // selection's client rectangles
  let sel = view.root.getSelection()!
  if (sel.rangeCount == 0) return true
  let rects = sel.getRangeAt(0).getClientRects()
  for (let i = 0; i < rects.length; i++) {
    let rect = rects[i]
    if (rect.left <= event.clientX && rect.right >= event.clientX &&
        rect.top <= event.clientY && rect.bottom >= event.clientY) return true
  }
  return false
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
  for (let handlers of view.behavior.get(handleDOMEvents)) {
    for (let eventType in handlers)
      (result[eventType] || (result[eventType] = [])).push(handlers[eventType])
  }
  return result
}

const handlers: {[key: string]: (view: EditorView, event: any) => void} = Object.create(null)

// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
const brokenClipboardAPI = (browser.ie && browser.ie_version < 15) ||
  (browser.ios && browser.webkit_version < 604)

function capturePaste(view: EditorView) {
  let doc = view.dom.ownerDocument!
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
  view.dispatch(view.state.transaction.replaceSelection(text)
                .addMeta(Transaction.userEvent("paste")).scrollIntoView())
}

function mustCapture(event: KeyboardEvent): boolean {
  const enum mod { ctrl = 1, alt = 2, shift = 4, meta = 8 }
  let mods = (event.ctrlKey ? mod.ctrl : 0) | (event.metaKey ? mod.meta : 0) |
    (event.altKey ? mod.alt : 0) | (event.shiftKey ? mod.shift : 0)
  let code = event.keyCode, macCtrl = browser.mac && mods == mod.ctrl
  return code == 8 || (macCtrl && code == 72) ||  // Backspace, Ctrl-h on Mac
    code == 46 || (macCtrl && code == 68) || // Delete, Ctrl-d on Mac
    code == 27 || // Esc
    (mods == (browser.mac ? mod.meta : mod.ctrl) && // Ctrl/Cmd-[biyz]
     (code == 66 || code == 73 || code == 89 || code == 90))
}

handlers.keydown = (view, event: KeyboardEvent) => {
  if (mustCapture(event)) event.preventDefault()
  view.inputState.setSelectionOrigin("keyboard")
}

handlers.touchdown = handlers.touchmove = (view, event: MouseEvent) => {
  view.inputState.setSelectionOrigin("pointer")
}

handlers.mousedown = (view, event: MouseEvent) => {
  if (event.button == 0)
    view.startMouseSelection(event, updateMouseSelection(event.detail))
}

function rangeForClick(view: EditorView, pos: number, bias: -1 | 1, type: number): SelectionRange {
  if (type == 1) { // Single click
    return new SelectionRange(pos)
  } else if (type == 2) { // Double click
    return SelectionRange.groupAt(view.state, pos, bias)
  } else { // Triple click
    let context = LineContext.get(view, pos)
    if (context) return new SelectionRange(context.start + context.line.length, context.start)
    let {start, end} = view.state.doc.lineAt(pos)
    return new SelectionRange(start, end)
  }
}

function updateMouseSelection(type: number): MouseSelectionUpdate {
  return (view, startSelection, startPos, startBias, curPos, curBias, extend, multiple) => {
    let range = rangeForClick(view, curPos, curBias, type)
    if (startPos != curPos && !extend) {
      let startRange = rangeForClick(view, startPos, startBias, type)
      range = range.extend(Math.min(startRange.from, range.from), Math.max(startRange.to, range.to))
    }
    if (extend)
      return startSelection.replaceRange(startSelection.primary.extend(range.from, range.to))
    else if (multiple)
      return startSelection.addRange(range)
    else
      return EditorSelection.create([range])
  }
}

handlers.dragstart = (view, event: DragEvent) => {
  let {doc, selection: {primary}} = view.state
  let {mouseSelection} = view.inputState
  if (mouseSelection) mouseSelection.dragging = primary

  if (event.dataTransfer) {
    event.dataTransfer.setData("Text", doc.slice(primary.from, primary.to))
    event.dataTransfer.effectAllowed = "copyMove"
  }
}

handlers.drop = (view, event: DragEvent) => {
  if (!event.dataTransfer) return

  let dropPos = view.posAtCoords({x: event.clientX, y: event.clientY})
  let text = event.dataTransfer.getData("Text")
  if (dropPos < 0 || !text) return

  event.preventDefault()

  let tr = view.state.transaction
  let {mouseSelection} = view.inputState
  if (mouseSelection && mouseSelection.dragging && mouseSelection.dragMove) {
    tr = tr.replace(mouseSelection.dragging.from, mouseSelection.dragging.to, "")
    dropPos = tr.changes.mapPos(dropPos)
  }
  let change = new Change(dropPos, dropPos, view.state.splitLines(text))
  tr = tr.change(change)
    .setSelection(EditorSelection.single(dropPos, dropPos + change.length))
    .addMeta(Transaction.userEvent("drop"))
  view.focus()
  view.dispatch(tr)
}

handlers.paste = (view: EditorView, event: ClipboardEvent) => {
  view.docView.observer.flush()
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
  let doc = view.dom.ownerDocument!
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

handlers.copy = handlers.cut = (view, event: ClipboardEvent) => {
  let range = view.state.selection.primary
  if (range.empty) return

  let data = brokenClipboardAPI ? null : event.clipboardData
  let text = view.state.joinLines(view.state.doc.sliceLines(range.from, range.to))
  if (data) {
    event.preventDefault()
    data.clearData()
    data.setData("text/plain", text)
  } else {
    captureCopy(view, text)
  }
  if (event.type == "cut") {
    view.dispatch(view.state.transaction.replaceSelection([""]).scrollIntoView().addMeta(Transaction.userEvent("cut")))
  }
}

handlers.focus = view => {
  view.updateState([], view.state, [focusChange(true)])
}

handlers.blur = view => {
  view.updateState([], view.state, [focusChange(false)])
}

handlers.beforeprint = view => {
  view.docView.checkLayout(true)
}

handlers.compositionstart = handlers.compositionupdate = view => {
  view.docView.startComposition()
}

handlers.compositionend = view => {
  view.docView.endComposition()
}
