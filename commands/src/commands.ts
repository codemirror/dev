import {EditorState, StateCommand, EditorSelection, SelectionRange, Transaction,
        IndentContext, ChangeSpec} from "@codemirror/next/state"
import {Text, Line, countColumn} from "@codemirror/next/text"
import {EditorView, Command} from "@codemirror/next/view"

function updateSel(sel: EditorSelection, by: (range: SelectionRange) => SelectionRange) {
  return EditorSelection.create(sel.ranges.map(by), sel.primaryIndex)
}

function moveSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                       granularity: "character" | "word" | "line" | "lineboundary"): boolean {
  let selection = updateSel(view.state.selection, range => {
    if (!range.empty && granularity != "lineboundary")
      return EditorSelection.cursor(dir == "left" || dir == "backward" ? range.from : range.to)
    return EditorSelection.cursor(view.movePos(range.head, dir, granularity, "move"))
  })
  if (selection.eq(view.state.selection)) return false
  view.dispatch(view.state.update({
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
    return EditorSelection.range(range.anchor, view.movePos(range.head, dir, granularity, "extend"))
  })
  if (selection.eq(view.state.selection)) return false
  view.dispatch(view.state.update({
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
  dispatch(state.update({selection: {anchor: 0}, scrollIntoView: true}))
  return true
}

/// Move the selection to the end of the document.
export const selectDocEnd: StateCommand = ({state, dispatch}) => {
  dispatch(state.update({selection: {anchor: state.doc.length}, scrollIntoView: true}))
  return true
}

/// Select the entire document.
export const selectAll: StateCommand = ({state, dispatch}) => {
  dispatch(state.update({selection: {anchor: 0, head: state.doc.length}}))
  return true
}

function deleteText(view: EditorView, dir: "forward" | "backward") {
  let {state} = view, changes = state.changeByRange(range => {
    let {from, to} = range
    if (from == to) {
      let line = state.doc.lineAt(from), before
      if (dir == "backward" && from > line.start && from < line.start + 200 &&
          !/[^ \t]/.test(before = line.slice(0, from - line.start))) {
        if (before[before.length - 1] == "\t") {
          from--
        } else {
          let col = countColumn(before, 0, state.tabSize), drop = col % state.indentUnit || state.indentUnit
          for (let i = 0; i < drop && before[before.length - 1 - i] == " "; i++) from--
        }
      } else {
        let target = view.movePos(range.head, dir, "character", "move")
        from = Math.min(from, target); to = Math.max(to, target)
      }
    }
    if (from == to) return {range}
    return {changes: {from, to}, range: EditorSelection.cursor(from)}
  })
  if (changes.changes.empty) return false

  view.dispatch(view.state.update(changes, {scrollIntoView: true}))
  return true
}

/// Delete the character before the cursor (which is the one to left
/// in left-to-right text, but the one to the right in right-to-left
/// text).
export const deleteCharBackward: Command = view => deleteText(view, "backward")
/// Delete the character after the cursor.
export const deleteCharForward: Command = view => deleteText(view, "forward")

function indentString(state: EditorState, n: number) {
  let result = ""
  if (state.indentWithTabs) while (n >= state.tabSize) {
    result += "\t"
    n -= state.tabSize
  }
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
    let indent = getIndentation(new IndentContext(state, undefined, r.from), r.from)
    return indent > -1 ? indent : /^\s*/.exec(state.doc.lineAt(r.from).slice(0, 50))![0].length
  })
  let changes = state.changeByRange(({from, to}) => {
    let indent = indentation[i++], line = state.doc.lineAt(to)
    while (to < line.end && /s/.test(line.slice(to - line.start, to + 1 - line.start))) to++
    return {changes: {from, to, insert: Text.of(["", indentString(state, indent)])},
            range: EditorSelection.cursor(from + 1 + indent)}
  })
  dispatch(state.update(changes, {scrollIntoView: true}))
  return true
}

function changeBySelectedLine(state: EditorState, f: (line: Line, changes: ChangeSpec[], range: SelectionRange) => void) {
  let atLine = -1
  return state.changeByRange(range => {
    let changes: ChangeSpec[] = []
    for (let line = state.doc.lineAt(range.from);;) {
      if (line.number > atLine) {
        f(line, changes, range)
        atLine = line.number
      }
      if (range.to <= line.end) break
      line = state.doc.lineAt(line.end + 1)
    }
    let changeSet = state.changes(changes)
    return {changes,
            range: EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1))}
  })
}

/// Auto-indent the selected lines. This uses the [indentation
/// facet](#state.EditorState^indentation) as source for auto-indent
/// information.
export const indentSelection: StateCommand = ({state, dispatch}) => {
  let updated: {[lineStart: number]: number} = Object.create(null)
  let context = new IndentContext(state, start => {
    let found = updated[start]
    return found == null ? -1 : found
  })
  let changes = changeBySelectedLine(state, (line, changes, range) => {
    let indent = getIndentation(context, line.start)
    if (indent < 0) return
    let cur = /^\s*/.exec(line.slice(0, Math.min(line.length, 200)))![0]
    let norm = indentString(state, indent)
    if (cur != norm || range.from < line.start + cur.length) {
      updated[line.start] = indent
      changes.push({from: line.start, to: line.start + cur.length, insert: norm})
    }
  })
  if (!changes.changes!.empty) dispatch(state.update(changes))
  return true
}

/// Add a [unit](#state.EditorState^indentUnit) of indentation to all
/// selected lines.
export const indentMore: StateCommand = ({state, dispatch}) => {
  dispatch(state.update(changeBySelectedLine(state, (line, changes) => {
    changes.push({from: line.start, insert: state.facet(EditorState.indentUnit)})
  })))
  return true
}

/// Remove a [unit](#state.EditorState^indentUnit) of indentation from
/// all selected lines.
export const indentLess: StateCommand = ({state, dispatch}) => {
  dispatch(state.update(changeBySelectedLine(state, (line, changes) => {
    let lineStart = line.slice(0, Math.min(line.length, 200))
    let space = /^\s*/.exec(lineStart)![0]
    if (!space) return
    let col = countColumn(space, 0, state.tabSize), insert = indentString(state, Math.max(0, col - state.indentUnit)), keep = 0
    while (keep < space.length && keep < insert.length && space.charCodeAt(keep) == insert.charCodeAt(keep)) keep++
    changes.push({from: line.start + keep, to: line.start + space.length, insert: insert.slice(keep)})
  })))
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
  "Cmd-ArrowLeft": moveLineStart,
  "Cmd-ArrowRight": moveLineEnd,
  "Control-d": deleteCharForward,
  "Control-h": deleteCharBackward
}
for (let key in pcBaseKeymap) macBaseKeymap[key] = pcBaseKeymap[key]

declare const os: any
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

/// The default keymap for the current platform.
export const baseKeymap = mac ? macBaseKeymap : pcBaseKeymap
