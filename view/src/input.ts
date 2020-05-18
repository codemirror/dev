import {EditorSelection, EditorState, SelectionRange, Transaction} from "@codemirror/next/state"
import {EditorView} from "./editorview"
import {ContentView} from "./contentview"
import {domEventHandlers, ViewUpdate, PluginValue, clickAddsSelectionRange, dragMovesSelection as dragBehavior,
        logException, mouseSelectionStyle} from "./extension"
import browser from "./browser"
import {LineContext} from "./cursor"
import {getSelection, focusPreventScroll} from "./dom"

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

  startMouseSelection(view: EditorView, event: MouseEvent, style: MouseSelectionStyle) {
    if (this.mouseSelection) this.mouseSelection.destroy()
    this.mouseSelection = new MouseSelection(this, view, event, style)
  }

  update(update: ViewUpdate) {
    if (this.mouseSelection) this.mouseSelection.update(update)
    this.lastKeyCode = this.lastSelectionTime = 0
  }

  destroy() {
    if (this.mouseSelection) this.mouseSelection.destroy()
  }
}

/// Interface that objects registered with
/// [`EditorView.mouseSelectionStyle`](#view.EditorView^mouseSelectionStyle)
/// must conform to.
export interface MouseSelectionStyle {
  /// Return a new selection for the mouse gesture that starts with
  /// the event that was originally given to the constructor, and ends
  /// with the event passed here. In case of a plain click, those may
  /// both be the `mousedown` event, in case of a drag gesture, the
  /// latest `mousemove` event will be passed.
  ///
  /// When `extend` is true, that means the new selection should, if
  /// possible, extend the start selection. If `multiple` is true, the
  /// new selection should be added to the original selection.
  get: (curEvent: MouseEvent, extend: boolean, multiple: boolean) => EditorSelection
  /// Called when the view is updated while the gesture is in
  /// progress. When the document changed, it may be necessary to map
  /// some data (like the original selection or start position)
  /// through the changes.
  update: (update: ViewUpdate) => void
}

export type MakeSelectionStyle = (view: EditorView, event: MouseEvent) => MouseSelectionStyle | null

class MouseSelection {
  dragging: null | false | SelectionRange
  dragMove: boolean
  extend: boolean
  multiple: boolean

  constructor(private inputState: InputState, private view: EditorView,
              private startEvent: MouseEvent,
              private style: MouseSelectionStyle) {
    let doc = view.contentDOM.ownerDocument!
    doc.addEventListener("mousemove", this.move = this.move.bind(this))
    doc.addEventListener("mouseup", this.up = this.up.bind(this))

    this.extend = startEvent.shiftKey
    this.multiple = view.state.facet(EditorState.allowMultipleSelections) && addsSelectionRange(view, startEvent)
    this.dragMove = dragMovesSelection(view, startEvent)
    this.dragging = isInPrimarySelection(view, startEvent) ? null : false
    // When clicking outside of the selection, immediately apply the
    // effect of starting the selection
    if (this.dragging === false) {
      startEvent.preventDefault()
      this.select(startEvent)
    }
  }

  move(event: MouseEvent) {
    if (event.buttons == 0) return this.destroy()
    if (this.dragging !== false) return
    this.select(event)
  }

  up() {
    if (this.dragging == null) this.select(this.startEvent)
    this.destroy()
  }

  destroy() {
    let doc = this.view.contentDOM.ownerDocument!
    doc.removeEventListener("mousemove", this.move)
    doc.removeEventListener("mouseup", this.up)
    this.inputState.mouseSelection = null
  }

  select(event: MouseEvent) {
    let selection = this.style.get(event, this.extend, this.multiple)
    if (!selection.eq(this.view.state.selection))
      this.view.dispatch(this.view.state.update({
        selection,
        annotations: Transaction.userEvent.of("pointer"),
        scrollIntoView: true
      }))
  }

  update(update: ViewUpdate) {
    if (update.docChanged && this.dragging) this.dragging = this.dragging.map(update.changes)
    this.style.update(update)
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

function isInPrimarySelection(view: EditorView, event: MouseEvent) {
  let {primary} = view.state.selection
  if (primary.empty) return false
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
  view.dispatch(view.state.update(view.state.replaceSelection(text), {
    annotations: Transaction.userEvent.of("paste"),
    scrollIntoView: true
  }))
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
  let style: MouseSelectionStyle | null = null
  for (let makeStyle of view.state.facet(mouseSelectionStyle)) {
    style = makeStyle(view, event)
    if (style) break
  }
  if (!style && event.button == 0) style = basicMouseSelection(view, event)
  if (style) {
    focusPreventScroll(view.contentDOM)
    view.inputState.startMouseSelection(view, event, style)
  }
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

function queryPos(view: EditorView, event: MouseEvent): {pos: number, bias: 1 | -1} {
  let pos = view.posAtCoords({x: event.clientX, y: event.clientY})
  let coords = pos < 0 ? null : view.coordsAtPos(pos)
  let bias: 1 | -1 = !coords ? 1 :
    coords.top > event.clientY ? -1 :
    coords.bottom < event.clientY ? 1 :
    coords.left > event.clientX ? -1 : 1
  return {pos, bias}
}

function basicMouseSelection(view: EditorView, event: MouseEvent) {
  let start = queryPos(view, event), type = event.detail
  let startSel = view.state.selection
  return {
    update(update) {
      if (update.changes) {
        start.pos = update.changes.mapPos(start.pos)
        startSel = startSel.map(update.changes)
      }
    },
    get(event, extend, multiple) {
      let cur = queryPos(view, event)
      let range = rangeForClick(view, cur.pos, cur.bias, type)
      if (start.pos != cur.pos && !extend) {
        let startRange = rangeForClick(view, start.pos, start.bias, type)
        let from = Math.min(startRange.from, range.from), to = Math.max(startRange.to, range.to)
        range = from < range.from ? new SelectionRange(from, to) : new SelectionRange(to, from)
      }
      if (extend)
        return startSel.replaceRange(startSel.primary.extend(range.from, range.to))
      else if (multiple)
        return startSel.addRange(range)
      else
        return EditorSelection.create([range])
    }
  } as MouseSelectionStyle
}

handlers.dragstart = (view, event: DragEvent) => {
  let {selection: {primary}} = view.state
  let {mouseSelection} = view.inputState
  if (mouseSelection) mouseSelection.dragging = primary

  if (event.dataTransfer) {
    event.dataTransfer.setData("Text", view.state.sliceDoc(primary.from, primary.to))
    event.dataTransfer.effectAllowed = "copyMove"
  }
}

handlers.drop = (view, event: DragEvent) => {
  if (!event.dataTransfer) return

  let dropPos = view.posAtCoords({x: event.clientX, y: event.clientY})
  let text = event.dataTransfer.getData("Text")
  if (dropPos < 0 || !text) return

  event.preventDefault()

  let {mouseSelection} = view.inputState
  let del = mouseSelection && mouseSelection.dragging && mouseSelection.dragMove ?
    {from: mouseSelection.dragging.from, to: mouseSelection.dragging.to} : null
  let ins = {from: dropPos, insert: text}
  let changes = view.state.changes(del ? [del, ins] : ins)

  view.focus()
  view.dispatch(view.state.update({
    changes,
    selection: {anchor: changes.mapPos(dropPos, -1), head: changes.mapPos(dropPos, 1)},
    annotations: Transaction.userEvent.of("drop")
  }))
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
  let text = view.state.sliceDoc(range.from, range.to)
  if (data) {
    event.preventDefault()
    data.clearData()
    data.setData("text/plain", text)
  } else {
    captureCopy(view, text)
  }
  if (event.type == "cut")
    view.dispatch(view.state.update(view.state.replaceSelection(""), {
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("cut")
    }))
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
