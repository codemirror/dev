import {EditorSelection, EditorState, SelectionRange, Transaction} from "@codemirror/next/state"
import {EditorView, DOMEventHandlers} from "./editorview"
import {ContentView} from "./contentview"
import {LineView} from "./blockview"
import {domEventHandlers, ViewUpdate, PluginValue, clickAddsSelectionRange, dragMovesSelection as dragBehavior,
        logException, mouseSelectionStyle} from "./extension"
import browser from "./browser"
import {groupAt} from "./cursor"
import {getSelection, focusPreventScroll, Rect} from "./dom"

// This will also be where dragging info and such goes
export class InputState {
  lastKeyCode: number = 0
  lastKeyTime: number = 0
  lastSelectionOrigin: string | null = null
  lastSelectionTime: number = 0
  lastEscPress: number = 0
  scrollHandlers: ((event: Event) => boolean | void)[] = []

  registeredEvents: string[] = []
  customHandlers: readonly {
    plugin: PluginValue,
    handlers: DOMEventHandlers
  }[] = []

  composing = false
  compositionEndedAt = 0

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
        if (!eventBelongsToEditor(view, event) || this.ignoreDuringComposition(event) ||
            type == "keydown" && this.screenKeyEvent(view, event as KeyboardEvent)) return
        if (this.mustFlushObserver(event)) view.observer.forceFlush()
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
    this.notifiedFocused = view.hasFocus
    this.ensureHandlers(view)
  }

  ensureHandlers(view: EditorView) {
    let handlers = this.customHandlers = view.pluginField(domEventHandlers)
    for (let set of handlers) {
      for (let type in set.handlers) if (this.registeredEvents.indexOf(type) < 0 && type != "scroll") {
        this.registeredEvents.push(type)
        view.contentDOM.addEventListener(type, (event: Event) => {
          if (!eventBelongsToEditor(view, event)) return
          if (this.runCustomHandlers(type, view, event)) event.preventDefault()
        })
      }
    }
  }

  runCustomHandlers(type: string, view: EditorView, event: Event): boolean {
    for (let set of this.customHandlers) {
      let handler = set.handlers[type]
      if (handler) {
        try {
          if (handler.call(set.plugin, event as any, view) || event.defaultPrevented) return true
        } catch (e) {
          logException(view.state, e)
        }
      }
    }
    return false
  }

  runScrollHandlers(view: EditorView, event: Event) {
    for (let set of this.customHandlers) {
      let handler = set.handlers.scroll
      if (handler) {
        try { handler.call(set.plugin, event, view) }
        catch (e) { logException(view.state, e) }
      }
    }
  }

  ignoreDuringComposition(event: Event): boolean {
    if (!/^key/.test(event.type)) return false
    if (this.composing) return true
    // See https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/.
    // On some input method editors (IMEs), the Enter key is used to
    // confirm character selection. On Safari, when Enter is pressed,
    // compositionend and keydown events are sometimes emitted in the
    // wrong order. The key event should still be ignored, even when
    // it happens after the compositionend event.
    if (browser.safari && event.timeStamp - this.compositionEndedAt < 500) {
      this.compositionEndedAt = 0
      return true
    }
    return false
  }

  screenKeyEvent(view: EditorView, event: KeyboardEvent) {
    let protectedTab = event.keyCode == 9 && Date.now() < this.lastEscPress + 2000
    if (event.keyCode == 27) this.lastEscPress = Date.now()
    else if (modifierCodes.indexOf(event.keyCode) < 0) this.lastEscPress = 0
    return protectedTab
  }

  mustFlushObserver(event: Event) {
    return event.type == "keydown" || event.type == "compositionend"
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

// Key codes for modifier keys
export const modifierCodes = [16, 17, 18, 20, 91, 92, 224, 225]

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

  up(event: MouseEvent) {
    if (this.dragging == null) this.select(this.startEvent)
    if (!this.dragging) event.preventDefault()
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
    if (!selection.eq(this.view.state.selection) || selection.primary.assoc != this.view.state.selection.primary.assoc)
      this.view.dispatch({
        selection,
        annotations: Transaction.userEvent.of("pointerselection"),
        scrollIntoView: true
      })
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
  let parent = view.dom.parentNode
  if (!parent) return
  let target = parent.appendChild(document.createElement("textarea"))
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.focus()
  setTimeout(() => {
    view.focus()
    target.remove()
    doPaste(view, target.value)
  }, 50)
}

function doPaste(view: EditorView, input: string) {
  let {state} = view, changes, i = 1, text = state.toText(input)
  let byLine = text.lines == state.selection.ranges.length
  let linewise = lastLinewiseCopy && state.selection.ranges.every(r => r.empty) && lastLinewiseCopy == text.toString()
  if (linewise) {
    changes = {
      changes: state.selection.ranges.map(r => state.doc.lineAt(r.from))
        .filter((l, i, a) => i == 0 || a[i - 1] != l)
        .map(line => ({from: line.from, insert: (byLine ? text.line(i++).slice() : input) + state.lineBreak}))
    }
  } else if (byLine) {
    changes = state.changeByRange(range => {
      let line = text.line(i++)
      return {changes: {from: range.from, to: range.to, insert: line.slice()},
              range: EditorSelection.cursor(range.from + line.length)}
    })
  } else {
    changes = state.replaceSelection(text)
  }
  view.dispatch(changes, {
    annotations: Transaction.userEvent.of("paste"),
    scrollIntoView: true
  })
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
  view.inputState.setSelectionOrigin("keyboardselection")
}

handlers.touchdown = handlers.touchmove = view => {
  view.inputState.setSelectionOrigin("pointerselection")
}

handlers.mousedown = (view, event: MouseEvent) => {
  let style: MouseSelectionStyle | null = null
  for (let makeStyle of view.state.facet(mouseSelectionStyle)) {
    style = makeStyle(view, event)
    if (style) break
  }
  if (!style && event.button == 0) style = basicMouseSelection(view, event)
  if (style) {
    if (view.root.activeElement != view.contentDOM) view.observer.ignore(() => focusPreventScroll(view.contentDOM))
    view.inputState.startMouseSelection(view, event, style)
  }
}

function rangeForClick(view: EditorView, pos: number, bias: -1 | 1, type: number): SelectionRange {
  if (type == 1) { // Single click
    return EditorSelection.cursor(pos, bias)
  } else if (type == 2) { // Double click
    return groupAt(view.state, pos, bias)
  } else { // Triple click
    let line = LineView.find(view.docView, pos)
    if (line) return EditorSelection.range(line.posAtStart, line.posAtEnd)
    let {from, to} = view.state.doc.lineAt(pos)
    return EditorSelection.range(from, to)
  }
}

let insideY = (y: number, rect: Rect) => y >= rect.top && y <= rect.bottom
let inside = (x: number, y: number, rect: Rect) => insideY(y, rect) && x >= rect.left && x <= rect.right

// Try to determine, for the given coordinates, associated with the
// given position, whether they are related to the element before or
// the element after the position.
function findPositionSide(view: EditorView, pos: number, x: number, y: number) {
  let line = LineView.find(view.docView, pos)
  if (!line) return 1
  let off = pos - line.posAtStart
  // Line boundaries point into the line
  if (off == 0) return 1
  if (off == line.length) return -1

  // Positions on top of an element point at that element
  let before = line.coordsAt(off, -1)
  if (before && inside(x, y, before)) return -1
  let after = line.coordsAt(off, 1)
  if (after && inside(x, y, after)) return 1
  // This is probably a line wrap point. Pick before if the point is
  // beside it.
  return before && insideY(y, before) ? -1 : 1
}

function queryPos(view: EditorView, event: MouseEvent): {pos: number, bias: 1 | -1} | null {
  let pos = view.posAtCoords({x: event.clientX, y: event.clientY})
  if (pos == null) return null
  return {pos, bias: findPositionSide(view, pos, event.clientX, event.clientY)}
}

const BadMouseDetail = browser.ie && browser.ie_version <= 11
let lastMouseDown: MouseEvent | null = null, lastMouseDownCount = 0

function getClickType(event: MouseEvent) {
  if (!BadMouseDetail) return event.detail
  let last = lastMouseDown
  lastMouseDown = event
  return lastMouseDownCount = !last || (last.timeStamp > Date.now() - 400 && Math.abs(last.clientX - event.clientX) < 2 &&
                                        Math.abs(last.clientY - event.clientY) < 2) ? (lastMouseDownCount + 1) % 3 : 1
}

function basicMouseSelection(view: EditorView, event: MouseEvent) {
  let start = queryPos(view, event), type = getClickType(event)
  let startSel = view.state.selection
  let last = start, lastEvent = event
  return {
    update(update) {
      if (update.changes) {
        if (start) start.pos = update.changes.mapPos(start.pos)
        startSel = startSel.map(update.changes)
      }
    },
    get(event, extend, multiple) {
      let cur
      if (event.clientX == lastEvent.clientX && event.clientY == lastEvent.clientY) cur = last
      else { cur = last = queryPos(view, event); lastEvent = event }
      if (!cur || !start) return startSel
      let range = rangeForClick(view, cur.pos, cur.bias, type)
      if (start.pos != cur.pos && !extend) {
        let startRange = rangeForClick(view, start.pos, start.bias, type)
        let from = Math.min(startRange.from, range.from), to = Math.max(startRange.to, range.to)
        range = from < range.from ? EditorSelection.range(from, to) : EditorSelection.range(to, from)
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
  if (dropPos == null || !text) return

  event.preventDefault()

  let {mouseSelection} = view.inputState
  let del = mouseSelection && mouseSelection.dragging && mouseSelection.dragMove ?
    {from: mouseSelection.dragging.from, to: mouseSelection.dragging.to} : null
  let ins = {from: dropPos, insert: text}
  let changes = view.state.changes(del ? [del, ins] : ins)

  view.focus()
  view.dispatch({
    changes,
    selection: {anchor: changes.mapPos(dropPos, -1), head: changes.mapPos(dropPos, 1)},
    annotations: Transaction.userEvent.of("drop")
  })
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
  let parent = view.dom.parentNode
  if (!parent) return
  let target = parent.appendChild(document.createElement("textarea"))
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.value = text
  target.focus()
  target.selectionEnd = text.length
  target.selectionStart = 0
  setTimeout(() => {
    target.remove()
    view.focus()
  }, 50)
}

function copiedRange(state: EditorState) {
  let content = [], ranges: {from: number, to: number}[] = [], linewise = false
  for (let range of state.selection.ranges) if (!range.empty) {
    content.push(state.sliceDoc(range.from, range.to))
    ranges.push(range)
  }
  if (!content.length) {
    // Nothing selected, do a line-wise copy
    let upto = -1
    for (let {from} of state.selection.ranges) {
      let line = state.doc.lineAt(from)
      if (line.number > upto) {
        content.push(line.slice())
        ranges.push({from: line.from, to: Math.min(state.doc.length, line.to + 1)})
      }
      upto = line.number
    }
    linewise = true
  }

  return {text: content.join(state.lineBreak), ranges, linewise}
}

let lastLinewiseCopy: string | null = null

handlers.copy = handlers.cut = (view, event: ClipboardEvent) => {
  let {text, ranges, linewise} = copiedRange(view.state)
  if (!text) return
  lastLinewiseCopy = linewise ? text : null

  let data = brokenClipboardAPI ? null : event.clipboardData
  if (data) {
    event.preventDefault()
    data.clearData()
    data.setData("text/plain", text)
  } else {
    captureCopy(view, text)
  }
  if (event.type == "cut")
    view.dispatch({
      changes: ranges,
      scrollIntoView: true,
      annotations: Transaction.userEvent.of("cut")
    })
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
  view.inputState.compositionEndedAt = Date.now()
  setTimeout(() => {
    if (!view.inputState.composing) forceClearComposition(view)
  }, 50)
}
