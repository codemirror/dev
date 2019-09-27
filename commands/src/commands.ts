import {EditorState, EditorSelection, SelectionRange, Transaction} from "../../state/src"
import {EditorView} from "../../view/src"

/// Command functions are used in key bindings and other types of user
/// actions. Given an editor state and a dispatch function, they check
/// whether their effect can apply in the current editor state, and if
/// it can, perform it as a side effect (which usually means
/// dispatching a transaction) and return `true`.
export type Command = (target: {state: EditorState, dispatch: (transaction: Transaction) => void}) => boolean

/// Some commands need direct access to the [editor
/// view](#view.EditorView). View commands are expect a view object as
/// argument. `Command` is a subtype of `ViewCommand`, and code that
/// expects any kind of command usually works with the `ViewCommand`
/// type. (The distinction is mostly there because most commands do
/// not need an entire view, and it is helpful to be able to test them
/// in isolation, outside of the browser.)
export type ViewCommand = (target: EditorView) => boolean

function moveSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                       granularity: "character" | "word" | "line" | "lineboundary"): boolean {
  let transaction = view.state.t().forEachRange(range => {
    if (!range.empty && granularity != "lineboundary")
      return new SelectionRange(dir == "left" || dir == "backward" ? range.from : range.to)
    return new SelectionRange(view.movePos(range.head, dir, granularity, "move"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction.addMeta(Transaction.preserveGoalColumn(true))
  view.dispatch(transaction.scrollIntoView())
  return true
}

/// Move the selection one character to the left (which is backward in
/// left-to-right text, forward in right-to-left text).
export const moveCharLeft: ViewCommand = view => moveSelection(view, "left", "character")
/// Move the selection one character to the right.
export const moveCharRight: ViewCommand = view => moveSelection(view, "right", "character")

/// Move the selection one word to the left.
export const moveWordLeft: ViewCommand = view => moveSelection(view, "left", "word")
/// Move the selection one word to the right.
export const moveWordRight: ViewCommand = view => moveSelection(view, "right", "word")

/// Move the selection one line up.
export const moveLineUp: ViewCommand = view => moveSelection(view, "backward", "line")
/// Move the selection one line down.
export const moveLineDown: ViewCommand = view => moveSelection(view, "forward", "line")

/// Move the selection to the start of the line.
export const moveLineStart: ViewCommand = view => moveSelection(view, "backward", "lineboundary")
/// Move the selection to the end of the line.
export const moveLineEnd: ViewCommand = view => moveSelection(view, "forward", "lineboundary")

function extendSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                         granularity: "character" | "word" | "line" | "lineboundary"): boolean {
  let transaction = view.state.t().forEachRange(range => {
    return new SelectionRange(range.anchor, view.movePos(range.head, dir, granularity, "extend"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction.addMeta(Transaction.preserveGoalColumn(true))
  view.dispatch(transaction.scrollIntoView())
  return true
}

/// Move the selection head one character to the left, while leaving
/// the anchor in place.
export const extendCharLeft: ViewCommand = view => extendSelection(view, "left", "character")
/// Move the selection head one character to the right.
export const extendCharRight: ViewCommand = view => extendSelection(view, "right", "character")

/// Move the selection head one word to the left.
export const extendWordLeft: ViewCommand = view => extendSelection(view, "left", "word")
/// Move the selection head one word to the right.
export const extendWordRight: ViewCommand = view => extendSelection(view, "right", "word")

/// Move the selection head one line up.
export const extendLineUp: ViewCommand = view => extendSelection(view, "backward", "line")
/// Move the selection head one line down.
export const extendLineDown: ViewCommand = view => extendSelection(view, "forward", "line")

/// Move the selection head to the start of the line.
export const extendLineStart: ViewCommand = view => extendSelection(view, "backward", "lineboundary")
/// Move the selection head to the end of the line.
export const extendLineEnd: ViewCommand = view => extendSelection(view, "forward", "lineboundary")

/// Move the selection to the start of the document.
export const selectDocStart: Command = ({state, dispatch}) => {
  dispatch(state.t().setSelection(EditorSelection.single(0)).scrollIntoView())
  return true
}

/// Move the selection to the end of the document.
export const selectDocEnd: Command = ({state, dispatch}) => {
  dispatch(state.t().setSelection(EditorSelection.single(state.doc.length)).scrollIntoView())
  return true
}

/// Select the entire document.
export const selectAll: Command = ({state, dispatch}) => {
  dispatch(state.t().setSelection(EditorSelection.single(0, state.doc.length)))
  return true
}

function deleteText(view: EditorView, dir: "forward" | "backward") {
  let transaction = view.state.t().forEachRange((range, transaction) => {
    let {from, to} = range
    if (from == to) {
      let target = view.movePos(range.head, dir, "character", "move")
      from = Math.min(from, target); to = Math.max(to, target)
    }
    if (from == to) return range
    transaction.replace(from, to, "")
    return new SelectionRange(from)
  })
  if (!transaction.docChanged) return false

  view.dispatch(transaction.scrollIntoView())
  return true
}

/// Delete the character before the cursor (which is the one to left
/// in left-to-right text, but the one to the right in right-to-left
/// text).
export const deleteCharBackward: ViewCommand = view => deleteText(view, "backward")
/// Delete the character after the cursor.
export const deleteCharForward: ViewCommand = view => deleteText(view, "forward")

// FIXME support indenting by tab, configurable indent units

function space(n: number) {
  let result = ""
  for (let i = 0; i < n; i++) result += " "
  return result
}

function getIndentation(state: EditorState, pos: number): number {
  for (let f of state.behavior(EditorState.indentation)) {
    let result = f(state, pos)
    if (result > -1) return result
  }
  return -1
}

/// Replace the selection with a newline and indent the newly created
/// line(s).
export const insertNewlineAndIndent: Command = ({state, dispatch}): boolean => {
  let i = 0, indentation = state.selection.ranges.map(r => {
    let indent = getIndentation(state, r.from)
    return indent > -1 ? indent : /^\s*/.exec(state.doc.lineAt(r.from).slice(0, 50))![0].length
  })
  dispatch(state.t().forEachRange(({from, to}, tr) => {
    let indent = indentation[i++], line = tr.doc.lineAt(to)
    while (to < line.end && /s/.test(line.slice(to - line.start, to + 1 - line.start))) to++
    tr.replace(from, to, ["", space(indent)])
    return new SelectionRange(from + indent + 1)
  }).scrollIntoView())
  return true
}

/// Auto-indent the selected lines. This uses the [indentation
/// behavor](#state.EditorState^indentation) as source.
export const indentSelection: Command = ({state, dispatch}): boolean => {
  // FIXME this will base all indentation on the same state, which is
  // wrong (indentation looks at the indent of previous lines, which may
  // be changed).
  let lastLine = -1, positions = []
  for (let range of state.selection.ranges) {
    for (let {start, end} = state.doc.lineAt(range.from);;) {
      if (start != lastLine) {
        lastLine = start
        let indent = getIndentation(state, start), current
        if (indent > -1 &&
            indent != (current = /^\s*/.exec(state.doc.slice(start, Math.min(end, start + 100)))![0].length))
          positions.push({pos: start, current, indent})
      }
      if (end + 1 > range.to) break
      ;({start, end} = state.doc.lineAt(end + 1))
    }
  }
  if (positions.length > 0) {
    let tr = state.t()
    for (let {pos, current, indent} of positions) {
      let start = tr.changes.mapPos(pos)
      tr.replace(start, start + current, space(indent))
    }
    dispatch(tr)
  }
  return true
}

/// The default keymap for Linux/Windows/non-Mac platforms. Binds the
/// arrows for cursor motion, shift-arrow for selection extension,
/// ctrl-arrows for by-word motion, home/end for line start/end,
/// ctrl-home/end for document start/end, ctrl-a to select all,
/// backspace/delete for deletion, and enter for newline-and-indent.
export const pcBaseKeymap: {[key: string]: ViewCommand} = {
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
export const macBaseKeymap: {[key: string]: ViewCommand} = {
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

declare global { const os: any }
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

/// The default keymap for the current platform.
export const baseKeymap = mac ? macBaseKeymap : pcBaseKeymap
