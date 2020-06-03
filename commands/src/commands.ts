import {EditorState, StateCommand, EditorSelection, SelectionRange,
        IndentContext, ChangeSpec, CharCategory, Transaction} from "@codemirror/next/state"
import {Text, Line, countColumn} from "@codemirror/next/text"
import {EditorView, Command, Direction} from "@codemirror/next/view"

function updateSel(sel: EditorSelection, by: (range: SelectionRange) => SelectionRange) {
  return EditorSelection.create(sel.ranges.map(by), sel.primaryIndex)
}

function setSel(state: EditorState, selection: EditorSelection | {anchor: number, head?: number}) {
  return state.update({selection, scrollIntoView: true, annotations: Transaction.userEvent.of("keyboardselection")})
}

function moveSel(view: EditorView, how: (range: SelectionRange) => SelectionRange): boolean {
  let selection = updateSel(view.state.selection, how)
  if (selection.eq(view.state.selection)) return false
  view.dispatch(setSel(view.state, selection))
  return true
}

function moveByChar(view: EditorView, forward: boolean) {
  return moveSel(view, range =>
                 range.empty ? view.moveByChar(range, forward) : EditorSelection.cursor(forward ? range.to : range.from))
}

/// Move the selection one character to the left (which is backward in
/// left-to-right text, forward in right-to-left text).
export const moveCharLeft: Command = view => moveByChar(view, view.textDirection != Direction.LTR)
/// Move the selection one character to the right.
export const moveCharRight: Command = view => moveByChar(view, view.textDirection == Direction.LTR)

/// Move the selection one character forward.
export const moveCharForward: Command = view => moveByChar(view, true)
/// Move the selection one character backward.
export const moveCharBackward: Command = view => moveByChar(view, false)

function moveByGroup(view: EditorView, forward: boolean) {
  return moveSel(view, range =>
                 range.empty ? view.moveByGroup(range, forward) : EditorSelection.cursor(forward ? range.to : range.from))
}

/// Move the selection across one group of word or non-word (but also
/// non-space) characters.
export const moveGroupLeft: Command = view => moveByGroup(view, view.textDirection != Direction.LTR)
/// Move the selection one group to the right.
export const moveGroupRight: Command = view => moveByGroup(view, view.textDirection == Direction.LTR)

/// Move the selection one group forward.
export const moveGroupForward: Command = view => moveByGroup(view, true)
/// Move the selection one group backward.
export const moveGroupBackward: Command = view => moveByGroup(view, false)

function moveByLine(view: EditorView, forward: boolean) {
  return moveSel(view, range => view.moveVertically(range, forward))
}

/// Move the selection one line up.
export const moveLineUp: Command = view => moveByLine(view, false)
/// Move the selection one line down.
export const moveLineDown: Command = view => moveByLine(view, true)

function moveByPage(view: EditorView, forward: boolean) {
  return moveSel(view, range => view.moveVertically(range, forward, view.dom.clientHeight))
}

/// Move the selection one page up.
export const movePageUp: Command = view => moveByPage(view, false)
/// Move the selection one page down.
export const movePageDown: Command = view => moveByPage(view, true)

function moveLineBoundary(view: EditorView, forward: boolean) {
  return moveSel(view, range => {
    let moved = view.moveToLineBoundary(range, forward)
    return moved.head == range.head ? view.moveToLineBoundary(range, forward, false) : moved
  })
}

/// Move the selection to the next line wrap point, or to the end of
/// the line if there isn't one left on this line.
export const moveLineBoundaryForward: Command = view => moveLineBoundary(view, false)
/// Move the selection to previous line wrap point, or failing that to
/// the start of the line.
export const moveLineBoundaryBackward: Command = view => moveLineBoundary(view, true)

/// Move the selection to the start of the line.
export const moveLineStart: Command = view => moveSel(view, range => EditorSelection.cursor(view.lineAt(range.head).from, 1))
/// Move the selection to the end of the line.
export const moveLineEnd: Command = view => moveSel(view, range => EditorSelection.cursor(view.lineAt(range.head).to, -1))

function extendSel(view: EditorView, how: (range: SelectionRange) => SelectionRange): boolean {
  let selection = updateSel(view.state.selection, range => {
    let head = how(range)
    return EditorSelection.range(range.anchor, head.head)
  })
  if (selection.eq(view.state.selection)) return false
  view.dispatch(setSel(view.state, selection))
  return true
}

function extendByChar(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveByChar(range, forward))
}

/// Move the selection head one character to the left, while leaving
/// the anchor in place.
export const extendCharLeft: Command = view => extendByChar(view, view.textDirection != Direction.LTR)
/// Move the selection head one character to the right.
export const extendCharRight: Command = view => extendByChar(view, view.textDirection == Direction.LTR)

/// Move the selection head one character forward.
export const extendCharForward: Command = view => extendByChar(view, true)
/// Move the selection head one character backward.
export const extendCharBackward: Command = view => extendByChar(view, false)

function extendByGroup(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveByGroup(range, forward))
}

/// Move the selection head one [group](#commands.moveGroupLeft) to
/// the left.
export const extendGroupLeft: Command = view => extendByGroup(view, view.textDirection != Direction.LTR)
/// Move the selection head one group to the right.
export const extendGroupRight: Command = view => extendByGroup(view, view.textDirection == Direction.LTR)

/// Move the selection head one group forward.
export const extendGroupForward: Command = view => extendByGroup(view, true)
/// Move the selection head one group backward.
export const extendGroupBackward: Command = view => extendByGroup(view, false)

function extendByLine(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveVertically(range, forward))
}

/// Move the selection head one line up.
export const extendLineUp: Command = view => extendByLine(view, false)
/// Move the selection head one line down.
export const extendLineDown: Command = view => extendByLine(view, true)

function extendByPage(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveVertically(range, forward, view.dom.clientHeight))
}

/// Move the selection head one page up.
export const extendPageUp: Command = view => extendByPage(view, false)
/// Move the selection head one page down.
export const extendPageDown: Command = view => extendByPage(view, true)

function extendByLineBoundary(view: EditorView, forward: boolean) {
  return extendSel(view, range => {
    let head = view.moveToLineBoundary(range, forward)
    return head.head == range.head ? view.moveToLineBoundary(range, forward, false) : head
  })
}

/// Move the selection head to the next line boundary.
export const extendLineBoundaryForward: Command = view => extendByLineBoundary(view, false)
/// Move the selection head to the previous line boundary.
export const extendLineBoundaryBackward: Command = view => extendByLineBoundary(view, true)

/// Move the selection head to the start of the line.
export const extendLineStart: Command = view => extendSel(view, range => EditorSelection.cursor(view.lineAt(range.head).from))
/// Move the selection head to the end of the line.
export const extendLineEnd: Command = view => extendSel(view, range => EditorSelection.cursor(view.lineAt(range.head).to))

/// Move the selection to the start of the document.
export const selectDocStart: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: 0}))
  return true
}

/// Move the selection to the end of the document.
export const selectDocEnd: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: state.doc.length}))
  return true
}

/// Move the selection head to the start of the document.
export const extendDocStart: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: state.selection.primary.anchor, head: 0}))
  return true
}

/// Move the selection head to the end of the document.
export const extendDocEnd: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: state.selection.primary.anchor, head: state.doc.length}))
  return true
}

/// Select the entire document.
export const selectAll: StateCommand = ({state, dispatch}) => {
  dispatch(state.update({selection: {anchor: 0, head: state.doc.length}, annotations: Transaction.userEvent.of("keyboarselection")}))
  return true
}

function deleteBy(view: EditorView, by: (start: number) => number) {
  let {state} = view, changes = state.changeByRange(range => {
    let {from, to} = range
    if (from == to) {
      let towards = by(from)
      from = Math.min(from, towards)
      to = Math.max(to, towards)
    }
    return from == to ? {range} : {changes: {from, to}, range: EditorSelection.cursor(from)}
  })
  if (changes.changes.empty) return false
  view.dispatch(view.state.update(changes, {scrollIntoView: true, annotations: Transaction.userEvent.of("delete")}))
  return true
}

const deleteByChar = (view: EditorView, forward: boolean) => deleteBy(view, pos => {
  let {state} = view, line = state.doc.lineAt(pos), before
  if (!forward && pos > line.start && pos < line.start + 200 &&
      !/[^ \t]/.test(before = line.slice(0, pos - line.start))) {
    if (before[before.length - 1] == "\t") return pos - 1
    let col = countColumn(before, 0, state.tabSize), drop = col % state.indentUnit || state.indentUnit
    for (let i = 0; i < drop && before[before.length - 1 - i] == " "; i++) pos--
    return pos
  }
  let target = line.findClusterBreak(pos - line.start, forward) + line.start
  if (target == pos && line.number != (forward ? state.doc.lines : 0))
    target += forward ? 1 : -1
  return target
})

/// Delete the selection, or, for cursor selections, the character
/// before the cursor.
export const deleteCharBackward: Command = view => deleteByChar(view, false)
/// Delete the selection or the character after the cursor.
export const deleteCharForward: Command = view => deleteByChar(view, true)

const deleteByGroup = (view: EditorView, forward: boolean) => deleteBy(view, pos => {
  let {state} = view, line = state.doc.lineAt(pos), categorize = state.charCategorizer(pos)
  for (let cat: CharCategory | null = null;;) {
    let next, nextChar
    if (pos == (forward ? line.end : line.start)) {
      if (line.number == (forward ? state.doc.lines : 1)) break
      line = state.doc.line(line.number + (forward ? 1 : -1))
      next = forward ? line.start : line.end
      nextChar = "\n"
    } else {
      next = line.findClusterBreak(pos - line.start, forward) + line.start
      nextChar = line.slice(Math.min(pos, next) - line.start, Math.max(pos, next) - line.start)
    }
    let nextCat = categorize(nextChar)
    if (cat != null && nextCat != cat) break
    if (nextCat != CharCategory.Space) cat = nextCat
    pos = next
  }
  return pos
})

/// Delete the selection or backward until the end of the next
/// [group](#view.EditorView.moveByGroup).
export const deleteGroupBackward: Command = view => deleteByGroup(view, false)
/// Delete the selection or forward until the end of the next group.
export const deleteGroupForward: Command = view => deleteByGroup(view, true)

/// Delete the selection, or, if it is a cursor selection, delete to
/// the end of the line. If the cursor is directly at the end of the
/// line, delete the line break after it.
export const deleteToLineEnd: Command = view => deleteBy(view, pos => {
  let lineEnd = view.lineAt(pos).to
  if (pos < lineEnd) return lineEnd
  return Math.max(view.state.doc.length, pos + 1)
})

/// Replace each selection range with a line break, leaving the cursor
/// on the line before the break.
export const splitLine: StateCommand = ({state, dispatch}) => {
  let changes = state.changeByRange(range => {
    return {changes: {from: range.from, to: range.to, insert: Text.of(["", ""])},
            range: EditorSelection.cursor(range.from)}
  })
  dispatch(state.update(changes, {scrollIntoView: true, annotations: Transaction.userEvent.of("input")}))
  return true
}

/// Flip the characters before and after the cursor(s).
export const transposeChars: StateCommand = ({state, dispatch}) => {
  let changes = state.changeByRange(range => {
    if (!range.empty || range.from == 0 || range.from == state.doc.length) return {range}
    let pos = range.from, line = state.doc.lineAt(pos)
    let from = pos == line.start ? pos - 1 : line.findClusterBreak(pos - line.start, false) + line.start
    let to = pos == line.end ? pos + 1 : line.findClusterBreak(pos - line.start, true) + line.start
    return {changes: {from, to, insert: state.doc.slice(pos, to).append(state.doc.slice(from, pos))},
            range: EditorSelection.cursor(to)}
  })
  if (changes.changes.empty) return false
  dispatch(state.update(changes, {scrollIntoView: true}))
  return true
}

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

const sharedBaseKeymap: {[key: string]: Command} = {
  "ArrowLeft": moveCharLeft,
  "Shift-ArrowLeft": extendCharLeft,
  "ArrowRight": moveCharRight,
  "Shift-ArrowRight": extendCharRight,

  "ArrowUp": moveLineUp,
  "Shift-ArrowUp": extendLineUp,
  "ArrowDown": moveLineDown,
  "Shift-ArrowDown": extendLineDown,

  "PageUp": movePageUp,
  "Shift-PageUp": extendPageUp,
  "PageDown": movePageDown,
  "Shift-PageDown": extendPageDown,

  "Home": moveLineBoundaryBackward,
  "Shift-Home": extendLineBoundaryBackward,
  "Mod-Home": selectDocStart,
  "Shift-Mod-Home": extendDocStart,

  "End": moveLineBoundaryForward,
  "Shift-End": extendLineBoundaryForward,
  "Mod-End": selectDocEnd,
  "Shift-Mod-End": extendDocEnd,

  "Mod-a": selectAll,

  "Backspace": deleteCharBackward,
  "Delete": deleteCharForward,

  "Enter": insertNewlineAndIndent,
}

/// The default keymap for Linux/Windows/non-Mac platforms. Binds the
/// arrows for cursor motion, shift-arrow for selection extension,
/// ctrl-arrows for by-group motion, home/end for line start/end,
/// ctrl-home/end for document start/end, ctrl-a to select all,
/// backspace/delete for deletion, and enter for newline-and-indent.
export const pcBaseKeymap: {[key: string]: Command} = {
  "Mod-ArrowLeft": moveGroupLeft,
  "Shift-Mod-ArrowLeft": extendGroupLeft,
  "Mod-ArrowRight": moveGroupRight,
  "Shift-Mod-ArrowRight": extendGroupRight,

  "Mod-Backspace": deleteGroupBackward,
  "Mod-Delete": deleteGroupForward,
}

/// Keymap containing the Emacs-style part of the [macOS base
/// keymap](#commands.macBaseKeymap).
export const emacsStyleBaseKeymap: {[key: string]: Command} = {
  "Ctrl-b": moveCharLeft,
  "Shift-Ctrl-b": extendCharLeft,
  "Ctrl-f": moveCharRight,
  "Shift-Ctrl-f": extendCharRight,

  "Ctrl-p": moveLineUp,
  "Shift-Ctrl-p": extendLineUp,
  "Ctrl-n": moveLineDown,
  "Shift-Ctrl-n": extendLineDown,

  "Ctrl-a": moveLineStart,
  "Shift-Ctrl-a": extendLineStart,
  "Ctrl-e": moveLineEnd,
  "Shift-Ctrl-e": extendLineEnd,

  "Ctrl-d": deleteCharForward,
  "Ctrl-h": deleteCharBackward,
  "Ctrl-k": deleteToLineEnd,

  "Ctrl-o": splitLine,
  "Ctrl-t": transposeChars,

  "Alt-f": moveGroupForward,
  "Alt-b": moveGroupBackward,

  "Alt-<": selectDocStart,
  "Alt->": selectDocEnd,

  "Ctrl-v": movePageDown,
  "Alt-v": movePageUp,
  "Alt-d": deleteGroupForward,
  "Ctrl-Alt-h": deleteGroupBackward,
}

/// The default keymap for Mac platforms.
export const macBaseKeymap: {[key: string]: Command} = {
  "Cmd-ArrowUp": selectDocStart,
  "Shift-Cmd-ArrowUp": extendDocStart,
  "Ctrl-ArrowUp": movePageUp,
  "Shift-Ctrl-ArrowUp": extendPageUp,
  "Alt-ArrowUp": moveLineBoundaryBackward,
  "Shift-Alt-ArrowUp": extendLineBoundaryBackward,

  "Cmd-ArrowDown": selectDocEnd,
  "Shift-Cmd-ArrowDown": extendDocEnd,
  "Ctrl-ArrowDown": movePageDown,
  "Shift-Ctrl-ArrowDown": extendPageDown,
  "Alt-ArrowDown": movePageDown,
  "Shift-Alt-ArrowDown": extendPageDown,

  "Cmd-ArrowLeft": moveLineStart,
  "Shift-Cmd-ArrowLeft": extendLineStart,
  "Ctrl-ArrowLeft": moveLineStart,
  "Shift-Ctrl-ArrowLeft": extendLineStart,
  "Alt-ArrowLeft": moveGroupLeft,
  "Shift-Alt-ArrowLeft": extendGroupLeft,

  "Cmd-ArrowRight": moveLineEnd,
  "Shift-Cmd-ArrowRight": extendLineEnd,
  "Ctrl-ArrowRight": moveLineEnd,
  "Shift-Ctrl-ArrowRight": extendLineEnd,
  "Alt-ArrowRight": moveGroupRight,
  "Shift-Alt-ArrowRight": extendGroupRight,

  "Alt-Backspace": deleteGroupBackward,
  "Ctrl-Alt-Backspace": deleteGroupBackward,
  "Alt-Delete": deleteGroupForward,
}

for (let key in emacsStyleBaseKeymap) macBaseKeymap[key] = emacsStyleBaseKeymap[key]
for (let key in sharedBaseKeymap) macBaseKeymap[key] = pcBaseKeymap[key] = sharedBaseKeymap[key]

declare const os: any
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

/// The default keymap for the current platform.
export const baseKeymap = mac ? macBaseKeymap : pcBaseKeymap
