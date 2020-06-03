import {EditorState, StateCommand, EditorSelection, SelectionRange,
        IndentContext, ChangeSpec, CharCategory, Transaction} from "@codemirror/next/state"
import {Text, Line, countColumn} from "@codemirror/next/text"
import {EditorView, Command, Direction} from "@codemirror/next/view"

function updateSel(sel: EditorSelection, by: (range: SelectionRange) => SelectionRange) {
  return EditorSelection.create(sel.ranges.map(by), sel.primaryIndex)
}

const kbSelection = Transaction.userEvent.of("keyboardselection")

function moveSel(view: EditorView, how: (range: SelectionRange) => SelectionRange): boolean {
  let selection = updateSel(view.state.selection, how)
  if (selection.eq(view.state.selection)) return false
  view.dispatch(view.state.update({selection, scrollIntoView: true, annotations: kbSelection}))
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

function moveByGroup(view: EditorView, forward: boolean) {
  return moveSel(view, range =>
                 range.empty ? view.moveByGroup(range, forward) : EditorSelection.cursor(forward ? range.to : range.from))
}

/// Move the selection one word to the left.
export const moveGroupLeft: Command = view => moveByGroup(view, view.textDirection != Direction.LTR)
/// Move the selection one word to the right.
export const moveGroupRight: Command = view => moveByGroup(view, view.textDirection == Direction.LTR)

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

/// Move the selection to the start of the line.
export const moveLineStart: Command = view => moveLineBoundary(view, false)
/// Move the selection to the end of the line.
export const moveLineEnd: Command = view => moveLineBoundary(view, true)

function extendSel(view: EditorView, how: (range: SelectionRange) => SelectionRange): boolean {
  let selection = updateSel(view.state.selection, range => {
    let head = how(range)
    return EditorSelection.range(range.anchor, head.head)
  })
  if (selection.eq(view.state.selection)) return false
  view.dispatch(view.state.update({selection, scrollIntoView: true, annotations: kbSelection}))
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

function extendByGroup(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveByGroup(range, forward))
}

/// Move the selection head one word to the left.
export const extendGroupLeft: Command = view => extendByGroup(view, view.textDirection != Direction.LTR)
/// Move the selection head one word to the right.
export const extendGroupRight: Command = view => extendByGroup(view, view.textDirection == Direction.LTR)

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

/// Move the selection head to the start of the line.
export const extendLineStart: Command = view => extendByLineBoundary(view, false)
/// Move the selection head to the end of the line.
export const extendLineEnd: Command = view => extendByLineBoundary(view, true)

/// Move the selection to the start of the document.
export const selectDocStart: StateCommand = ({state, dispatch}) => {
  dispatch(state.update({selection: {anchor: 0}, scrollIntoView: true, annotations: kbSelection}))
  return true
}

/// Move the selection to the end of the document.
export const selectDocEnd: StateCommand = ({state, dispatch}) => {
  dispatch(state.update({selection: {anchor: state.doc.length}, scrollIntoView: true, annotations: kbSelection}))
  return true
}

/// Select the entire document.
export const selectAll: StateCommand = ({state, dispatch}) => {
  dispatch(state.update({selection: {anchor: 0, head: state.doc.length}, annotations: kbSelection}))
  return true
}

function deleteText(view: EditorView, forward: boolean, group: boolean) {
  let {state} = view, changes = state.changeByRange(range => {
    let {from, to} = range
    if (from == to) {
      let line = state.doc.lineAt(from), before
      if (group) {
        let categorize = view.state.charCategorizer(from)
        let head = from
        for (let cat: CharCategory | null = null;;) {
          let next, nextChar
          if (head == (forward ? line.end : line.start)) {
            if (line.number == (forward ? state.doc.lines : 1)) break
            line = state.doc.line(line.number + (forward ? 1 : -1))
            next = forward ? line.start : line.end
            nextChar = "\n"
          } else {
            next = line.findClusterBreak(head - line.start, forward) + line.start
            nextChar = line.slice(Math.min(head, next) - line.start, Math.max(head, next) - line.start)
          }
          let nextCat = categorize(nextChar)
          if (cat != null && nextCat != cat) break
          if (nextCat != CharCategory.Space) cat = nextCat
          head = next
        }
        if (forward) to = head; else from = head
      } else if (!forward && from > line.start && from < line.start + 200 &&
          !/[^ \t]/.test(before = line.slice(0, from - line.start))) {
        if (before[before.length - 1] == "\t") {
          from--
        } else {
          let col = countColumn(before, 0, state.tabSize), drop = col % state.indentUnit || state.indentUnit
          for (let i = 0; i < drop && before[before.length - 1 - i] == " "; i++) from--
        }
      } else {
        let target = line.findClusterBreak(from - line.start, forward) + line.start
        if (target == from && line.number != (forward ? state.doc.lines : 0))
          target += forward ? 1 : -1
        if (forward) to = target; else from = target
      }
    }
    if (from == to) return {range}
    return {changes: {from, to}, range: EditorSelection.cursor(from)}
  })
  if (changes.changes.empty) return false

  view.dispatch(view.state.update(changes, {scrollIntoView: true, annotations: Transaction.userEvent.of("delete")}))
  return true
}

/// Delete the selection, or, for cursor selections, the character
/// before the cursor.
export const deleteCharBackward: Command = view => deleteText(view, false, false)
/// Delete the selection or the character after the cursor.
export const deleteCharForward: Command = view => deleteText(view, true, false)

/// Delete the selection or backward until the end of the next
/// [group](#view.EditorView.moveByGroup).
export const deleteGroupBackward: Command = view => deleteText(view, false, true)
/// Delete the selection or forward until the end of the next group.
export const deleteGroupForward: Command = view => deleteText(view, true, true)

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
/// ctrl-arrows for by-group motion, home/end for line start/end,
/// ctrl-home/end for document start/end, ctrl-a to select all,
/// backspace/delete for deletion, and enter for newline-and-indent.
export const pcBaseKeymap: {[key: string]: Command} = {
  "ArrowLeft": moveCharLeft,
  "ArrowRight": moveCharRight,
  "Shift-ArrowLeft": extendCharLeft,
  "Shift-ArrowRight": extendCharRight,
  "Mod-ArrowLeft": moveGroupLeft,
  "Mod-ArrowRight": moveGroupRight,
  "Shift-Mod-ArrowLeft": extendGroupLeft,
  "Shift-Mod-ArrowRight": extendGroupRight,
  "ArrowUp": moveLineUp,
  "ArrowDown": moveLineDown,
  "Shift-ArrowUp": extendLineUp,
  "Shift-ArrowDown": extendLineDown,
  "PageUp": movePageUp,
  "PageDown": movePageDown,
  "Shift-PageUp": extendPageUp,
  "Shift-PageDown": extendPageDown,
  "Home": moveLineStart,
  "End": moveLineEnd,
  "Shift-Home": extendLineStart,
  "Shift-End": extendLineEnd,
  "Mod-Home": selectDocStart,
  "Mod-End": selectDocEnd,
  "Mod-a": selectAll,
  "Backspace": deleteCharBackward,
  "Delete": deleteCharForward,
  "Mod-Backspace": deleteGroupBackward,
  "Mod-Delete": deleteGroupForward,
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
