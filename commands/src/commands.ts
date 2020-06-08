import {EditorState, StateCommand, EditorSelection, SelectionRange,
        IndentContext, ChangeSpec, CharCategory, Transaction} from "@codemirror/next/state"
import {Text, Line, countColumn} from "@codemirror/next/text"
import {EditorView, Command, Direction} from "@codemirror/next/view"
import {KeyBinding} from "@codemirror/next/keymap"

function updateSel(sel: EditorSelection, by: (range: SelectionRange) => SelectionRange) {
  return EditorSelection.create(sel.ranges.map(by), sel.primaryIndex)
}

function setSel(state: EditorState, selection: EditorSelection | {anchor: number, head?: number}) {
  return state.update({selection, scrollIntoView: true, annotations: Transaction.userEvent.of("keyboardselection")})
}

function moveSel({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void},
                 how: (range: SelectionRange) => SelectionRange): boolean {
  let selection = updateSel(state.selection, how)
  if (selection.eq(state.selection)) return false
  dispatch(setSel(state, selection))
  return true
}

function cursorByChar(view: EditorView, forward: boolean) {
  return moveSel(view, range =>
                 range.empty ? view.moveByChar(range, forward) : EditorSelection.cursor(forward ? range.to : range.from))
}

/// Move the selection one character to the left (which is backward in
/// left-to-right text, forward in right-to-left text).
export const cursorCharLeft: Command = view => cursorByChar(view, view.textDirection != Direction.LTR)
/// Move the selection one character to the right.
export const cursorCharRight: Command = view => cursorByChar(view, view.textDirection == Direction.LTR)

/// Move the selection one character forward.
export const cursorCharForward: Command = view => cursorByChar(view, true)
/// Move the selection one character backward.
export const cursorCharBackward: Command = view => cursorByChar(view, false)

function cursorByGroup(view: EditorView, forward: boolean) {
  return moveSel(view, range =>
                 range.empty ? view.moveByGroup(range, forward) : EditorSelection.cursor(forward ? range.to : range.from))
}

/// Move the selection across one group of word or non-word (but also
/// non-space) characters.
export const cursorGroupLeft: Command = view => cursorByGroup(view, view.textDirection != Direction.LTR)
/// Move the selection one group to the right.
export const cursorGroupRight: Command = view => cursorByGroup(view, view.textDirection == Direction.LTR)

/// Move the selection one group forward.
export const cursorGroupForward: Command = view => cursorByGroup(view, true)
/// Move the selection one group backward.
export const cursorGroupBackward: Command = view => cursorByGroup(view, false)

function cursorByLine(view: EditorView, forward: boolean) {
  return moveSel(view, range => view.moveVertically(range, forward))
}

/// Move the selection one line up.
export const cursorLineUp: Command = view => cursorByLine(view, false)
/// Move the selection one line down.
export const cursorLineDown: Command = view => cursorByLine(view, true)

function cursorByPage(view: EditorView, forward: boolean) {
  return moveSel(view, range => view.moveVertically(range, forward, view.dom.clientHeight))
}

/// Move the selection one page up.
export const cursorPageUp: Command = view => cursorByPage(view, false)
/// Move the selection one page down.
export const cursorPageDown: Command = view => cursorByPage(view, true)

function moveByLineBoundary(view: EditorView, start: SelectionRange, forward: boolean) {
  let line = view.lineAt(start.head), moved = view.moveToLineBoundary(start, forward)
  if (moved.head == start.head && moved.head != (forward ? line.to : line.from))
    moved = view.moveToLineBoundary(start, forward, false)
  if (!forward && moved.head == line.from && line.length) {
    let space = /^\s*/.exec(view.state.sliceDoc(line.from, Math.min(line.from + 100, line.to)))![0].length
    if (space && start.head > line.from + space) moved = EditorSelection.cursor(line.from + space)
  }
  return moved
}

/// Move the selection to the next line wrap point, or to the end of
/// the line if there isn't one left on this line.
export const cursorLineBoundaryForward: Command = view => moveSel(view, range => moveByLineBoundary(view, range, true))
/// Move the selection to previous line wrap point, or failing that to
/// the start of the line.
export const cursorLineBoundaryBackward: Command = view => moveSel(view, range => moveByLineBoundary(view, range, false))

/// Move the selection to the start of the line.
export const cursorLineStart: Command = view => moveSel(view, range => EditorSelection.cursor(view.lineAt(range.head).from, 1))
/// Move the selection to the end of the line.
export const cursorLineEnd: Command = view => moveSel(view, range => EditorSelection.cursor(view.lineAt(range.head).to, -1))

function extendSel(view: EditorView, how: (range: SelectionRange) => SelectionRange): boolean {
  let selection = updateSel(view.state.selection, range => {
    let head = how(range)
    return EditorSelection.range(range.anchor, head.head, head.goalColumn)
  })
  if (selection.eq(view.state.selection)) return false
  view.dispatch(setSel(view.state, selection))
  return true
}

function selectByChar(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveByChar(range, forward))
}

/// Move the selection head one character to the left, while leaving
/// the anchor in place.
export const selectCharLeft: Command = view => selectByChar(view, view.textDirection != Direction.LTR)
/// Move the selection head one character to the right.
export const selectCharRight: Command = view => selectByChar(view, view.textDirection == Direction.LTR)

/// Move the selection head one character forward.
export const selectCharForward: Command = view => selectByChar(view, true)
/// Move the selection head one character backward.
export const selectCharBackward: Command = view => selectByChar(view, false)

function selectByGroup(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveByGroup(range, forward))
}

/// Move the selection head one [group](#commands.moveGroupLeft) to
/// the left.
export const selectGroupLeft: Command = view => selectByGroup(view, view.textDirection != Direction.LTR)
/// Move the selection head one group to the right.
export const selectGroupRight: Command = view => selectByGroup(view, view.textDirection == Direction.LTR)

/// Move the selection head one group forward.
export const selectGroupForward: Command = view => selectByGroup(view, true)
/// Move the selection head one group backward.
export const selectGroupBackward: Command = view => selectByGroup(view, false)

function selectByLine(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveVertically(range, forward))
}

/// Move the selection head one line up.
export const selectLineUp: Command = view => selectByLine(view, false)
/// Move the selection head one line down.
export const selectLineDown: Command = view => selectByLine(view, true)

function selectByPage(view: EditorView, forward: boolean) {
  return extendSel(view, range => view.moveVertically(range, forward, view.dom.clientHeight))
}

/// Move the selection head one page up.
export const selectPageUp: Command = view => selectByPage(view, false)
/// Move the selection head one page down.
export const selectPageDown: Command = view => selectByPage(view, true)

/// Move the selection head to the next line boundary.
export const selectLineBoundaryForward: Command = view => extendSel(view, range => moveByLineBoundary(view, range, true))
/// Move the selection head to the previous line boundary.
export const selectLineBoundaryBackward: Command = view => extendSel(view, range => moveByLineBoundary(view, range, false))

/// Move the selection head to the start of the line.
export const selectLineStart: Command = view => extendSel(view, range => EditorSelection.cursor(view.lineAt(range.head).from))
/// Move the selection head to the end of the line.
export const selectLineEnd: Command = view => extendSel(view, range => EditorSelection.cursor(view.lineAt(range.head).to))

/// Move the selection to the start of the document.
export const cursorDocStart: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: 0}))
  return true
}

/// Move the selection to the end of the document.
export const cursorDocEnd: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: state.doc.length}))
  return true
}

/// Move the selection head to the start of the document.
export const selectDocStart: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: state.selection.primary.anchor, head: 0}))
  return true
}

/// Move the selection head to the end of the document.
export const selectDocEnd: StateCommand = ({state, dispatch}) => {
  dispatch(setSel(state, {anchor: state.selection.primary.anchor, head: state.doc.length}))
  return true
}

/// Select the entire document.
export const selectAll: StateCommand = ({state, dispatch}) => {
  dispatch(state.update({selection: {anchor: 0, head: state.doc.length}, annotations: Transaction.userEvent.of("keyboarselection")}))
  return true
}

/// Select the next syntactic construct that is larger than the
/// selection. Note that this will only work insofar as the language
/// [syntaxes](#state.EditorState^syntax) you use builds up a full
/// syntax tree.
export const selectParentSyntax: StateCommand = ({state, dispatch}) => {
  let selection = updateSel(state.selection, range => {
    let context = state.tree.resolve(range.head, 1)
    while (!((context.start < range.from && context.end >= range.to) ||
             (context.end > range.to && context.start <= range.from) ||
             !context.parent?.parent))
      context = context.parent
    return EditorSelection.range(context.end, context.start)
  })
  dispatch(setSel(state, selection))
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

function selectedLineBlocks(state: EditorState) {
  let blocks = [], upto = -1
  for (let range of state.selection.ranges) {
    let startLine = state.doc.lineAt(range.from), endLine = state.doc.lineAt(range.to)
    if (upto == startLine.number) blocks[blocks.length - 1].to = endLine.end
    else blocks.push({from: startLine.start, to: endLine.end})
    upto = endLine.number
  }
  return blocks
}

function moveLine(state: EditorState, dispatch: (tr: Transaction) => void, forward: boolean): boolean {
  let changes = []
  for (let block of selectedLineBlocks(state)) {
    if (forward ? block.to == state.doc.length : block.from == 0) continue
    let nextLine = state.doc.lineAt(forward ? block.to + 1 : block.from - 1)
    if (forward)
      changes.push({from: block.to, to: nextLine.end},
                   {from: block.from, insert: nextLine.slice() + state.lineBreak})
    else
      changes.push({from: nextLine.start, to: block.from},
                   {from: block.to, insert: state.lineBreak + nextLine.slice()})
  }
  if (!changes.length) return false
  dispatch(state.update({changes, scrollIntoView: true}))
  return true
}

/// Move the selected lines up one line.
export const moveLineUp: StateCommand = ({state, dispatch}) => moveLine(state, dispatch, false)
/// Move the selected lines down one line.
export const moveLineDown: StateCommand = ({state, dispatch}) => moveLine(state, dispatch, true)

function copyLine(state: EditorState, dispatch: (tr: Transaction) => void, forward: boolean): boolean {
  let changes = []
  for (let block of selectedLineBlocks(state)) {
    if (forward)
      changes.push({from: block.from, insert: state.doc.slice(block.from, block.to) + state.lineBreak})
    else
      changes.push({from: block.to, insert: state.lineBreak + state.doc.slice(block.from, block.to)})
  }
  dispatch(state.update({changes, scrollIntoView: true}))
  return true
}

/// Create a copy of the selected lines. Keep the selection in the top copy.
export const copyLineUp: StateCommand = ({state, dispatch}) => copyLine(state, dispatch, false)
/// Create a copy of the selected lines. Keep the selection in the bottom copy.
export const copyLineDown: StateCommand = ({state, dispatch}) => copyLine(state, dispatch, true)

/// Delete selected lines.
export const deleteLine: Command = view => {
  let {state} = view, changes = state.changes(selectedLineBlocks(state).map(({from, to}) => {
    if (from > 0) from--
    else if (to < state.doc.length) to++
    return {from, to}
  }))
  let selection = updateSel(state.selection, range => view.moveVertically(range, true)).map(changes)
  view.dispatch(state.update({changes, selection, scrollIntoView: true}))
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

/// Key bindings containing the Emacs-style bindings that are
/// available on macOS by default. (These are included in
/// [`baseKeymap`](#commands.baseKeymap), with their `key` property
/// changed to `mac`.)
export const emacsStyleBaseKeymap: readonly KeyBinding[] = [
  {key:"Ctrl-b", run: cursorCharLeft, shift: selectCharLeft},
  {key: "Ctrl-f", run: cursorCharRight, shift: selectCharRight},

  {key: "Ctrl-p", run: cursorLineUp, shift: selectLineUp},
  {key: "Ctrl-n", run: cursorLineDown, shift: selectLineDown},

  {key: "Ctrl-a", run: cursorLineStart, shift: selectLineStart},
  {key: "Ctrl-e", run: cursorLineEnd, shift: selectLineEnd},

  {key: "Ctrl-d", run: deleteCharForward},
  {key: "Ctrl-h", run: deleteCharBackward},
  {key: "Ctrl-k", run: deleteToLineEnd},

  {key: "Ctrl-o", run: splitLine},
  {key: "Ctrl-t", run: transposeChars},

  {key: "Alt-f", run: cursorGroupForward},
  {key: "Alt-b", run: cursorGroupBackward},

  {key: "Alt-<", run: cursorDocStart},
  {key: "Alt->", run: cursorDocEnd},

  {key: "Ctrl-v", run: cursorPageDown},
  {key: "Alt-v", run: cursorPageUp},
  {key: "Alt-d", run: deleteGroupForward},
  {key: "Ctrl-Alt-h", run: deleteGroupBackward},
]

export const baseKeymap: readonly KeyBinding[] = ([
  {key: "ArrowLeft", run: cursorCharLeft, shift: selectCharLeft},
  {key: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", run: cursorGroupLeft, shift: selectGroupLeft},
  {mac: "Cmd-ArrowLeft", run: cursorLineStart, shift: selectLineStart},
  {mac: "Ctrl-ArrowLeft", run: cursorLineStart, shift: selectLineStart},

  {key: "ArrowRight", run: cursorCharRight, shift: selectCharRight},
  {key: "Mod-ArrowRight", mac: "Alt-ArrowRight", run: cursorGroupRight, shift: selectGroupRight},
  {mac: "Cmd-ArrowRight", run: cursorLineEnd, shift: selectLineEnd},
  {mac: "Ctrl-ArrowRight", run: cursorLineEnd, shift: selectLineEnd},

  {key: "ArrowUp", run: cursorLineUp, shift: selectLineUp},
  {key: "Alt-ArrowUp", run: moveLineUp},
  {key: "Shift-Alt-ArrowUp", run: copyLineUp},
  {mac: "Cmd-ArrowUp", run: cursorDocStart, shift: selectDocStart},
  {mac: "Ctrl-ArrowUp", run: cursorPageUp, shift: selectPageUp},

  {key: "ArrowDown", run: cursorLineDown, shift: selectLineDown},
  {key: "Alt-ArrowDown", run: moveLineDown},
  {key: "Shift-Alt-ArrowDown", run: copyLineDown},
  {mac: "Cmd-ArrowDown", run: cursorDocEnd, shift: selectDocEnd},
  {mac: "Ctrl-ArrowDown", run: cursorPageDown, shift: selectPageDown},

  {key: "PageUp", run: cursorPageUp, shift: selectPageUp},
  {key: "PageDown", run: cursorPageDown, shift: selectPageDown},

  {key: "Home", run: cursorLineBoundaryBackward, shift: selectLineBoundaryBackward},
  {key: "Mod-Home", run: cursorDocStart, shift: selectDocStart},

  {key: "End", run: cursorLineBoundaryForward, shift: selectLineBoundaryForward},
  {key: "Mod-End", run: cursorDocEnd, shift: selectDocEnd},

  {key: "Enter", run: insertNewlineAndIndent},

  {key: "Mod-a", run: selectAll},
  {key: "Mod-i", run: selectParentSyntax},

  {key: "Mod-[", run: indentLess},
  {key: "Mod-]", run: indentMore},

  {key: "Shift-Mod-k", run: deleteLine},

  {key: "Backspace", run: deleteCharBackward},
  {key: "Delete", run: deleteCharForward},
  {key: "Mod-Backspace", mac: "Ctrl-Alt-Backspace", run: deleteGroupBackward},
  {key: "Mod-Delete", mac: "Alt-Backspace", run: deleteGroupForward},

  {mac: "Alt-Delete", run: deleteGroupForward},
] as KeyBinding[]).concat(emacsStyleBaseKeymap.map(b => ({mac: b.key, run: b.run, shift: b.shift})))
