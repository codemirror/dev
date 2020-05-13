import {EditorState, StateCommand, EditorSelection, SelectionRange, Transaction, IndentContext} from "@codemirror/next/state"
import {EditorView, Command} from "@codemirror/next/view"

function updateSel(sel: EditorSelection, by: (range: SelectionRange) => SelectionRange) {
  return EditorSelection.create(sel.ranges.map(by), sel.primaryIndex)
}

function moveSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                       granularity: "character" | "word" | "line" | "lineboundary"): boolean {
  let selection = updateSel(view.state.selection, range => {
    if (!range.empty && granularity != "lineboundary")
      return new SelectionRange(dir == "left" || dir == "backward" ? range.from : range.to)
    return new SelectionRange(view.movePos(range.head, dir, granularity, "move"))
  })
  if (selection.eq(view.state.selection)) return false
  view.dispatch(view.state.tr({
    selection,
    annotations: granularity == "line" ? Transaction.preserveGoalColumn.of(true) : undefined,
    scrollIntoView: true
  }))
  return true
}

/// Move the selection one character to the left (which is backward in
/// left-to-right text, forward in right-to-left text).
export const moveCharLeft: Command = view => moveSelection(view, "left", "character")
/// Move the selection one character to the right.
export const moveCharRight: Command = view => moveSelection(view, "right", "character")

/// Move the selection one word to the left.
export const moveWordLeft: Command = view => moveSelection(view, "left", "word")
/// Move the selection one word to the right.
export const moveWordRight: Command = view => moveSelection(view, "right", "word")

/// Move the selection one line up.
export const moveLineUp: Command = view => moveSelection(view, "backward", "line")
/// Move the selection one line down.
export const moveLineDown: Command = view => moveSelection(view, "forward", "line")

/// Move the selection to the start of the line.
export const moveLineStart: Command = view => moveSelection(view, "backward", "lineboundary")
/// Move the selection to the end of the line.
export const moveLineEnd: Command = view => moveSelection(view, "forward", "lineboundary")

function extendSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                         granularity: "character" | "word" | "line" | "lineboundary"): boolean {
  let selection = updateSel(view.state.selection, range => {
    return new SelectionRange(range.anchor, view.movePos(range.head, dir, granularity, "extend"))
  })
  if (selection.eq(view.state.selection)) return false
  view.dispatch(view.state.tr({
    selection,
    annotations: granularity == "line" ? Transaction.preserveGoalColumn.of(true) : undefined,
    scrollIntoView: true
  }))
  return true
}

/// Move the selection head one character to the left, while leaving
/// the anchor in place.
export const extendCharLeft: Command = view => extendSelection(view, "left", "character")
/// Move the selection head one character to the right.
export const extendCharRight: Command = view => extendSelection(view, "right", "character")

/// Move the selection head one word to the left.
export const extendWordLeft: Command = view => extendSelection(view, "left", "word")
/// Move the selection head one word to the right.
export const extendWordRight: Command = view => extendSelection(view, "right", "word")

/// Move the selection head one line up.
export const extendLineUp: Command = view => extendSelection(view, "backward", "line")
/// Move the selection head one line down.
export const extendLineDown: Command = view => extendSelection(view, "forward", "line")

/// Move the selection head to the start of the line.
export const extendLineStart: Command = view => extendSelection(view, "backward", "lineboundary")
/// Move the selection head to the end of the line.
export const extendLineEnd: Command = view => extendSelection(view, "forward", "lineboundary")

/// Move the selection to the start of the document.
export const selectDocStart: StateCommand = ({state, dispatch}) => {
  dispatch(state.tr({selection: {anchor: 0}, scrollIntoView: true}))
  return true
}

/// Move the selection to the end of the document.
export const selectDocEnd: StateCommand = ({state, dispatch}) => {
  dispatch(state.tr({selection: {anchor: state.doc.length}, scrollIntoView: true}))
  return true
}

/// Select the entire document.
export const selectAll: StateCommand = ({state, dispatch}) => {
  dispatch(state.tr({selection: {anchor: 0, head: state.doc.length}}))
  return true
}

function deleteText(view: EditorView, dir: "forward" | "backward") {
  let changes = view.state.changeByRange(range => {
    let {from, to} = range
    if (from == to) {
      let target = view.movePos(range.head, dir, "character", "move")
      from = Math.min(from, target); to = Math.max(to, target)
    }
    if (from == to) return {range}
    return {changes: {from, to}, range: new SelectionRange(from)}
  })
  if (changes.changes.empty) return false

  view.dispatch(view.state.tr(changes, {scrollIntoView: true}))
  return true
}

/// Delete the character before the cursor (which is the one to left
/// in left-to-right text, but the one to the right in right-to-left
/// text).
export const deleteCharBackward: Command = view => deleteText(view, "backward")
/// Delete the character after the cursor.
export const deleteCharForward: Command = view => deleteText(view, "forward")

// FIXME support indenting by tab

function space(n: number) {
  let result = ""
  for (let i = 0; i < n; i++) result += " "
  return result
}

function getIndentation(cx: IndentContext, pos: number): number {
  for (let f of cx.state.facet(EditorState.indentation)) {
    let result = f(cx, pos)
    if (result > -1) return result
  }
  return -1
}

/// Replace the selection with a newline and indent the newly created
/// line(s).
export const insertNewlineAndIndent: StateCommand = ({state, dispatch}): boolean => {
  let i = 0, indentation = state.selection.ranges.map(r => {
    let indent = getIndentation(new IndentContext(state), r.from)
    return indent > -1 ? indent : /^\s*/.exec(state.doc.lineAt(r.from).slice(0, 50))![0].length
  })
  let changes = state.changeByRange(({from, to}) => {
    let indent = indentation[i++], line = state.doc.lineAt(to)
    while (to < line.end && /s/.test(line.slice(to - line.start, to + 1 - line.start))) to++
    return {changes: {from, to, insert: ["", space(indent)]},
            range: new SelectionRange(from + 1 + indent)}
  })
  dispatch(state.tr(changes, {scrollIntoView: true}))
  return true
}

/// Auto-indent the selected lines. This uses the [indentation
/// behavor](#state.EditorState^indentation) as source.
export const indentSelection: StateCommand = ({state, dispatch}): boolean => {
  let lastLine = -1, changes = []
  let updated: {[lineStart: number]: number} = Object.create(null)
  let context = new IndentContext(state, start => {
    let found = updated[start]
    return found == null ? -1 : found
  })
  for (let range of state.selection.ranges) {
    for (let {start, end} = state.doc.lineAt(range.from);;) {
      if (start != lastLine) {
        lastLine = start
        let indent = getIndentation(context, start), current
        if (indent > -1 &&
            indent != (current = /^\s*/.exec(state.doc.slice(start, Math.min(end, start + 100)))![0].length)) {
          updated[start] = indent
          changes.push({from: start, to: start + current, insert: space(indent)})
        }
      }
      if (end + 1 > range.to) break
      ;({start, end} = state.doc.lineAt(end + 1))
    }
  }
  if (changes.length > 0) dispatch(state.tr({changes}))
  return true
}

/// The default keymap for Linux/Windows/non-Mac platforms. Binds the
/// arrows for cursor motion, shift-arrow for selection extension,
/// ctrl-arrows for by-word motion, home/end for line start/end,
/// ctrl-home/end for document start/end, ctrl-a to select all,
/// backspace/delete for deletion, and enter for newline-and-indent.
export const pcBaseKeymap: {[key: string]: Command} = {
  "ArrowLeft": moveCharLeft,
  "ArrowRight": moveCharRight,
  "Shift-ArrowLeft": extendCharLeft,
  "Shift-ArrowRight": extendCharRight,
  "Mod-ArrowLeft": moveWordLeft,
  "Mod-ArrowRight": moveWordRight,
  "Shift-Mod-ArrowLeft": extendWordLeft,
  "Shift-Mod-ArrowRight": extendWordRight,
  "ArrowUp": moveLineUp,
  "ArrowDown": moveLineDown,
  "Shift-ArrowUp": extendLineUp,
  "Shift-ArrowDown": extendLineDown,
  "Home": moveLineStart,
  "End": moveLineEnd,
  "Shift-Home": extendLineStart,
  "Shift-End": extendLineEnd,
  "Mod-Home": selectDocStart,
  "Mod-End": selectDocEnd,
  "Mod-a": selectAll,
  "Backspace": deleteCharBackward,
  "Delete": deleteCharForward,
  "Enter": insertNewlineAndIndent
}

/// The default keymap for Mac platforms. Includes the bindings from
/// the [PC keymap](#commands.pcBaseKeymap) (using Cmd instead of
/// Ctrl), and adds Mac-specific default bindings.
export const macBaseKeymap: {[key: string]: Command} = {
  "Control-b": moveCharLeft,
  "Control-f": moveCharRight,
  "Shift-Control-b": extendCharLeft,
  "Shift-Control-f": extendCharRight,
  "Control-p": moveLineUp,
  "Control-n": moveLineDown,
  "Shift-Control-p": extendLineUp,
  "Shift-Control-n": extendLineDown,
  "Control-a": moveLineStart,
  "Control-e": moveLineEnd,
  "Shift-Control-a": extendLineStart,
  "Shift-Control-e": extendLineEnd,
  "Cmd-ArrowUp": selectDocStart,
  "Cmd-ArrowDown": selectDocEnd,
  "Control-d": deleteCharForward,
  "Control-h": deleteCharBackward
}
for (let key in pcBaseKeymap) macBaseKeymap[key] = pcBaseKeymap[key]

declare const os: any
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

/// The default keymap for the current platform.
export const baseKeymap = mac ? macBaseKeymap : pcBaseKeymap
