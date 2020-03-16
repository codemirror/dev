import {EditorSelection, EditorState, SelectionRange, Transaction, ChangeSet, Change} from "../../state"
import {EditorView} from "./editorview"
import {ContentView} from "./contentview"
import {domEventHandlers, ViewUpdate, PluginValue, clickAddsSelectionRange, dragMovesSelection as dragBehavior,
        logException} from "./extension"
import browser from "./browser"
import {LineContext} from "./cursor"
import {getSelection} from "./dom"

// This will also be where dragging info and such goes
export class InputState {
  lastKeyCode: number = 0
  lastKeyTime: number = 0
  lastSelectionOrigin: string | null = null
  lastSelectionTime: number = 0

  registeredEvents: string[] = []
  customHandlers: readonly {
    plugin: PluginValue,
    handlers: {[Type in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[Type], view: EditorView) => boolean}
  }[] = []

  composing = false

  goalColumns: {pos: number, column: number}[] = []

  mouseSelection: MouseSelection | null = null

  notifiedFocused: boolean

  setSelectionOrigin(origin: string) {
    this.lastSelectionOrigin = origin
    this.lastSelectionTime = Date.now()
  }

  constructor(view: EditorView) {
    for (let type in handlers) {
      let handler = handlers[type]
      view.contentDOM.addEventListener(type, (event: Event) => {
        if (!eventBelongsToEditor(view, event)) return
        if (this.runCustomHandlers(type, view, event)) event.preventDefault()
        else handler(view, event)
      })
      this.registeredEvents.push(type)
    }
    // Must always run, even if a custom handler handled the event
    view.contentDOM.addEventListener("keydown", (event: KeyboardEvent) => {
      view.inputState.lastKeyCode = event.keyCode
      view.inputState.lastKeyTime = Date.now()
    })
    if (view.root.activeElement == view.contentDOM) view.dom.classList.add("cm-focused")
    this.notifiedFocused = view.hasFocus
    this.ensureHandlers(view)
  }

  ensureHandlers(view: EditorView) {
    let handlers = this.customHandlers = view.pluginField(domEventHandlers)
    for (let set of handlers) {
      for (let type in set.handlers) if (this.registeredEvents.indexOf(type) < 0) {
        this.registeredEvents.push(type)
        ;(type != "scroll" ? view.contentDOM : view.scrollDOM).addEventListener(type, (event: Event) => {
          if (!eventBelongsToEditor(view, event)) return
          if (this.runCustomHandlers(type, view, event)) event.preventDefault()
        })
      }
    }
  }

  runCustomHandlers(type: string, view: EditorView, event: Event): boolean {
    for (let set of this.customHandlers) {
      let handler = set.handlers[type as keyof HTMLElementEventMap] as any
      if (handler) {
        try {
          if (handler.call(set.plugin, event, view) || event.defaultPrevented) return true
        } catch (e) {
          logException(view.state, e)
        }
      }
    }
    return false
  }

  startMouseSelection(view: EditorView, event: MouseEvent, update: MouseSelectionUpdate) {
    if (this.mouseSelection) this.mouseSelection.destroy()
    this.mouseSelection = new MouseSelection(this, view, event, update)
  }

  update(update: ViewUpdate) {
    if (this.mouseSelection) this.mouseSelection.map(update.changes)
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

    this.extend = event.shiftKey
    this.multiple = view.state.facet(EditorState.allowMultipleSelections) && addsSelectionRange(view, event)
    this.dragMove = dragMovesSelection(view, event)

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
    let coords = pos < 0 ? null : this.view.coordsAtPos(pos)
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

  up() {
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
      this.view.dispatch(this.view.state.t().setSelection(selection)
                         .annotate(Transaction.userEvent, "pointer")
                         .scrollIntoView())
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

function addsSelectionRange(view: EditorView, event: MouseEvent) {
  let facet = view.state.facet(clickAddsSelectionRange)
  return facet.length ? facet[0](event) : browser.mac ? event.metaKey : event.ctrlKey
}

function dragMovesSelection(view: EditorView, event: MouseEvent) {
  let facet = view.state.facet(dragBehavior)
  return facet.length ? facet[0](event) : browser.mac ? !event.altKey : !event.ctrlKey
}

function isInPrimarySelection(view: EditorView, pos: number, event: MouseEvent) {
  let {primary} = view.state.selection
  if (primary.empty) return false
  if (pos < primary.from || pos > primary.to) return false
  if (pos > primary.from && pos < primary.to) return true
  // On boundary clicks, check whether the coordinates are inside the
  // selection's client rectangles
  let sel = getSelection(view.root)
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
  for (let node: Node | null = event.target as Node, cView; node != view.contentDOM; node = node.parentNode)
    if (!node || node.nodeType == 11 || ((cView = ContentView.get(node)) && cView.ignoreEvent(event)))
      return false
  return true
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
  view.dispatch(view.state.t().replaceSelection(text)
                .annotate(Transaction.userEvent, "paste").scrollIntoView())
}

function mustCapture(event: KeyboardEvent): boolean {
  const enum Mod { Ctrl = 1, Alt = 2, Shift = 4, Meta = 8 }
  let mods = (event.ctrlKey ? Mod.Ctrl : 0) | (event.metaKey ? Mod.Meta : 0) |
    (event.altKey ? Mod.Alt : 0) | (event.shiftKey ? Mod.Shift : 0)
  let code = event.keyCode, macCtrl = browser.mac && mods == Mod.Ctrl
  return code == 8 || (macCtrl && code == 72) ||  // Backspace, Ctrl-h on Mac
    code == 46 || (macCtrl && code == 68) || // Delete, Ctrl-d on Mac
    code == 27 || // Esc
    (mods == (browser.mac ? Mod.Meta : Mod.Ctrl) && // Ctrl/Cmd-[biyz]
     (code == 66 || code == 73 || code == 89 || code == 90))
}

handlers.keydown = (view, event: KeyboardEvent) => {
  if (mustCapture(event)) event.preventDefault()
  view.inputState.setSelectionOrigin("keyboard")
}

handlers.touchdown = handlers.touchmove = view => {
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
      let from = Math.min(startRange.from, range.from), to = Math.max(startRange.to, range.to)
      range = from < range.from ? new SelectionRange(from, to) : new SelectionRange(to, from)
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

  let tr = view.state.t()
  let {mouseSelection} = view.inputState
  if (mouseSelection && mouseSelection.dragging && mouseSelection.dragMove) {
    tr.replace(mouseSelection.dragging.from, mouseSelection.dragging.to, "")
    dropPos = tr.changes.mapPos(dropPos)
  }
  let change = new Change(dropPos, dropPos, view.state.splitLines(text))
  tr.change(change)
    .setSelection(EditorSelection.single(dropPos, dropPos + change.length))
    .annotate(Transaction.userEvent, "drop")
  view.focus()
  view.dispatch(tr)
}

handlers.paste = (view: EditorView, event: ClipboardEvent) => {
  view.observer.flush()
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
    view.dispatch(view.state.t().replaceSelection([""]).scrollIntoView().annotate(Transaction.userEvent, "cut"))
  }
}

handlers.focus = handlers.blur = view => {
  setTimeout(() => {
    if (view.hasFocus != view.inputState.notifiedFocused) view.update([])
  }, 10)
}

handlers.beforeprint = view => {
  view.viewState.printing = true
  view.requestMeasure()
  setTimeout(() => {
    view.viewState.printing = false
    view.requestMeasure()
  }, 2000)
}

function forceClearComposition(view: EditorView) {
  if (view.docView.compositionDeco.size) view.update([])
}

handlers.compositionstart = handlers.compositionupdate = view => {
  if (!view.inputState.composing) {
    if (view.docView.compositionDeco.size) {
      view.observer.flush()
      forceClearComposition(view)
    }
    // FIXME possibly set a timeout to clear it again on Android
    view.inputState.composing = true
  }
}

handlers.compositionend = view => {
  view.inputState.composing = false
  setTimeout(() => {
    if (!view.inputState.composing) forceClearComposition(view)
  }, 50)
}
