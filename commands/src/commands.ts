import {EditorState, StateCommand, EditorSelection, SelectionRange,
        IndentContext, ChangeSpec, CharCategory, Transaction} from "@codemirror/next/state"
import {Text, Line, countColumn} from "@codemirror/next/text"
import {EditorView, Command, Direction, KeyBinding} from "@codemirror/next/view"
import {matchBrackets} from "@codemirror/next/matchbrackets"
import {Subtree, NodeProp} from "lezer-tree"

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

function interestingNode(state: EditorState, node: Subtree, bracketProp: NodeProp<unknown>) {
  if (node.type.prop(bracketProp)) return true
  let len = node.end - node.start
  return len && (len > 2 || /[^\s,.;:]/.test(state.sliceDoc(node.start, node.end))) || node.firstChild
}

function moveBySyntax(state: EditorState, start: SelectionRange, forward: boolean) {
  let pos = state.tree.resolve(start.head)
  let bracketProp = forward ? NodeProp.closedBy : NodeProp.openedBy
  // Scan forward through child nodes to see if there's an interesting
  // node ahead.
  for (let at = start.head;;) {
    let next = forward ? pos.childAfter(at) : pos.childBefore(at)
    if (!next) break
    if (interestingNode(state, next, bracketProp)) pos = next
    else at = forward ? next.end : next.start
  }
  let bracket = pos.type.prop(bracketProp), match, newPos
  if (bracket && (match = forward ? matchBrackets(state, pos.start, 1) : matchBrackets(state, pos.end, -1)) && match.matched)
    newPos = forward ? match.end!.to : match.end!.from
  else
    newPos = forward ? pos.end : pos.start
  return EditorSelection.cursor(newPos, forward ? -1 : 1)
}

/// Move the cursor over the next syntactic element to the left.
export const cursorSyntaxLeft: Command =
  view => moveSel(view, range => moveBySyntax(view.state, range, view.textDirection != Direction.LTR))
/// Move the cursor over the next syntactic element to the right.
export const cursorSyntaxRight: Command =
  view => moveSel(view, range => moveBySyntax(view.state, range, view.textDirection == Direction.LTR))

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
  let line = view.visualLineAt(start.head), moved = view.moveToLineBoundary(start, forward)
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
export const cursorLineStart: Command = view => moveSel(view, range => EditorSelection.cursor(view.visualLineAt(range.head).from, 1))
/// Move the selection to the end of the line.
export const cursorLineEnd: Command = view => moveSel(view, range => EditorSelection.cursor(view.visualLineAt(range.head).to, -1))

function toMatchingBracket(state: EditorState, dispatch: (tr: Transaction) => void, extend: boolean) {
  let found = false, selection = updateSel(state.selection, range => {
    let matching = matchBrackets(state, range.head, -1)
      || matchBrackets(state, range.head, 1)
      || (range.head > 0 && matchBrackets(state, range.head - 1, 1))
      || (range.head < state.doc.length && matchBrackets(state, range.head + 1, -1))
    if (!matching || !matching.end) return range
    found = true
    let head = matching.start.from == range.head ? matching.end.to : matching.end.from
    return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head)
  })
  if (!found) return false
  dispatch(setSel(state, selection))
  return true
}

/// Move the selection to the bracket matching the one it is currently
/// on, if any.
export const cursorMatchingBracket: StateCommand = ({state, dispatch}) => toMatchingBracket(state, dispatch, false)
/// Extend the selection to the bracket matching the one the selection
/// head is currently on, if any.
export const selectMatchingBracket: StateCommand = ({state, dispatch}) => toMatchingBracket(state, dispatch, true)

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

/// Move the selection head one [group](#commands.cursorGroupLeft) to
/// the left.
export const selectGroupLeft: Command = view => selectByGroup(view, view.textDirection != Direction.LTR)
/// Move the selection head one group to the right.
export const selectGroupRight: Command = view => selectByGroup(view, view.textDirection == Direction.LTR)

/// Move the selection head one group forward.
export const selectGroupForward: Command = view => selectByGroup(view, true)
/// Move the selection head one group backward.
export const selectGroupBackward: Command = view => selectByGroup(view, false)

/// Move the selection head over the next syntactic element to the left.
export const selectSyntaxLeft: Command =
  view => extendSel(view, range => moveBySyntax(view.state, range, view.textDirection != Direction.LTR))
/// Move the selection head over the next syntactic element to the right.
export const selectSyntaxRight: Command =
  view => extendSel(view, range => moveBySyntax(view.state, range, view.textDirection == Direction.LTR))

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
export const selectLineStart: Command = view => extendSel(view, range => EditorSelection.cursor(view.visualLineAt(range.head).from))
/// Move the selection head to the end of the line.
export const selectLineEnd: Command = view => extendSel(view, range => EditorSelection.cursor(view.visualLineAt(range.head).to))

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

/// Expand the selection to cover entire lines.
export const selectLine: StateCommand = ({state, dispatch}) => {
  let ranges = selectedLineBlocks(state).map(({from, to}) => EditorSelection.range(from, Math.min(to + 1, state.doc.length)))
  dispatch(state.update({selection: new EditorSelection(ranges), annotations: Transaction.userEvent.of("keyboardselection")}))
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

/// Simplify the current selection. When multiple ranges are selected,
/// reduce it to its primary range. Otherwise, if the selection is
/// non-empty, convert it to a cursor selection.
export const simplifySelection: StateCommand = ({state, dispatch}) => {
  let cur = state.selection, selection = null
  if (cur.ranges.length > 1) selection = new EditorSelection([cur.primary])
  else if (!cur.primary.empty) selection = new EditorSelection([EditorSelection.cursor(cur.primary.head)])
  if (!selection) return false
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
  view.dispatch(changes, {scrollIntoView: true, annotations: Transaction.userEvent.of("delete")})
  return true
}

const deleteByChar = (view: EditorView, forward: boolean) => deleteBy(view, pos => {
  let {state} = view, line = state.doc.lineAt(pos), before
  if (!forward && pos > line.from && pos < line.from + 200 &&
      !/[^ \t]/.test(before = line.slice(0, pos - line.from))) {
    if (before[before.length - 1] == "\t") return pos - 1
    let col = countColumn(before, 0, state.tabSize), drop = col % state.indentUnit || state.indentUnit
    for (let i = 0; i < drop && before[before.length - 1 - i] == " "; i++) pos--
    return pos
  }
  let target = line.findClusterBreak(pos - line.from, forward) + line.from
  if (target == pos && line.number != (forward ? state.doc.lines : 1))
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
    if (pos == (forward ? line.to : line.from)) {
      if (line.number == (forward ? state.doc.lines : 1)) break
      line = state.doc.line(line.number + (forward ? 1 : -1))
      next = forward ? line.from : line.to
      nextChar = "\n"
    } else {
      next = line.findClusterBreak(pos - line.from, forward) + line.from
      nextChar = line.slice(Math.min(pos, next) - line.from, Math.max(pos, next) - line.from)
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
  let lineEnd = view.visualLineAt(pos).to
  if (pos < lineEnd) return lineEnd
  return Math.max(view.state.doc.length, pos + 1)
})

/// Delete all whitespace directly before a line end from the
/// document.
export const deleteTrailingWhitespace: StateCommand = ({state, dispatch}) => {
  let changes = []
  for (let pos = 0, iter = state.doc.iterLines(); !iter.next().done;) {
    let trailing = iter.value.search(/\s+$/)
    if (trailing > -1) changes.push({from: pos + trailing, to: pos + iter.value.length})
    pos += iter.value.length + 1
  }
  if (!changes.length) return false
  dispatch(state.update({changes}))
  return true
}

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
    let from = pos == line.from ? pos - 1 : line.findClusterBreak(pos - line.from, false) + line.from
    let to = pos == line.to ? pos + 1 : line.findClusterBreak(pos - line.from, true) + line.from
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
    if (upto == startLine.number) blocks[blocks.length - 1].to = endLine.to
    else blocks.push({from: startLine.from, to: endLine.to})
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
      changes.push({from: block.to, to: nextLine.to},
                   {from: block.from, insert: nextLine.slice() + state.lineBreak})
    else
      changes.push({from: nextLine.from, to: block.from},
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
  view.dispatch({changes, selection, scrollIntoView: true})
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

/// Replace the selection with a newline.
export const insertNewline: StateCommand = ({state, dispatch}) => {
  dispatch(state.update(state.replaceSelection(state.lineBreak), {scrollIntoView: true}))
  return true
}

/// Replace the selection with a newline and indent the newly created
/// line(s). If the current line consists only of whitespace, this
/// will also delete that whitespace.
export const insertNewlineAndIndent: StateCommand = ({state, dispatch}): boolean => {
  let i = 0, indentation = state.selection.ranges.map(r => {
    let indent = getIndentation(new IndentContext(state, undefined, r.from), r.from)
    return indent > -1 ? indent : /^\s*/.exec(state.doc.lineAt(r.from).slice(0, 50))![0].length
  })
  let changes = state.changeByRange(({from, to}) => {
    let indent = indentation[i++], line = state.doc.lineAt(to)
    while (to < line.to && /s/.test(line.slice(to - line.from, to + 1 - line.from))) to++
    if (from > line.from && from < line.from + 100 && !/\S/.test(line.slice(0, from))) from = line.from
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
      if (range.to <= line.to) break
      line = state.doc.lineAt(line.to + 1)
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
    let indent = getIndentation(context, line.from)
    if (indent < 0) return
    let cur = /^\s*/.exec(line.slice(0, Math.min(line.length, 200)))![0]
    let norm = indentString(state, indent)
    if (cur != norm || range.from < line.from + cur.length) {
      updated[line.from] = indent
      changes.push({from: line.from, to: line.from + cur.length, insert: norm})
    }
  })
  if (!changes.changes!.empty) dispatch(state.update(changes))
  return true
}

/// Add a [unit](#state.EditorState^indentUnit) of indentation to all
/// selected lines.
export const indentMore: StateCommand = ({state, dispatch}) => {
  dispatch(state.update(changeBySelectedLine(state, (line, changes) => {
    changes.push({from: line.from, insert: state.facet(EditorState.indentUnit)})
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
    changes.push({from: line.from + keep, to: line.from + space.length, insert: insert.slice(keep)})
  })))
  return true
}

/// Array of key bindings containing the Emacs-style bindings that are
/// available on macOS by default.
///
///  - Ctrl-b: [`cursorCharLeft`](#commands.cursorCharLeft) ([`selectCharLeft`](#commands.selectCharLeft) with Shift)
///  - Ctrl-f: [`cursorCharRight`](#commands.cursorCharRight) ([`selectCharRight`](#commands.selectCharRight) with Shift)
///  - Ctrl-p: [`cursorLineUp`](#commands.cursorLineUp) ([`selectLineUp`](#commands.selectLineUp) with Shift)
///  - Ctrl-n: [`cursorLineDown`](#commands.cursorLineDown) ([`selectLineDown`](#commands.selectLineDown) with Shift)
///  - Ctrl-a: [`cursorLineStart`](#commands.cursorLineStart) ([`selectLineStart`](#commands.selectLineStart) with Shift)
///  - Ctrl-e: [`cursorLineEnd`](#commands.cursorLineEnd) ([`selectLineEnd`](#commands.selectLineEnd) with Shift)
///  - Ctrl-d: [`deleteCharForward`](#commands.deleteCharForward)
///  - Ctrl-h: [`deleteCharBackward`](#commands.deleteCharBackward)
///  - Ctrl-k: [`deleteToLineEnd`](#commands.deleteToLineEnd)
///  - Alt-d: [`deleteGroupForward`](#commands.deleteGroupForward)
///  - Ctrl-Alt-h: [`deleteGroupBackward`](#commands.deleteGroupBackward)
///  - Ctrl-o: [`splitLine`](#commands.splitLine)
///  - Ctrl-t: [`transposeChars`](#commands.transposeChars)
///  - Alt-f: [`cursorGroupForward`](#commands.cursorGroupForward) ([`selectGroupForward`](#commands.selectGroupForward) with Shift)
///  - Alt-b: [`cursorGroupBackward`](#commands.cursorGroupBackward) ([`selectGroupBackward`](#commands.selectGroupBackward) with Shift)
///  - Alt-<: [`cursorDocStart`](#commands.cursorDocStart)
///  - Alt->: [`cursorDocEnd`](#commands.cursorDocEnd)
///  - Ctrl-v: [`cursorPageDown`](#commands.cursorPageDown)
///  - Alt-v: [`cursorPageUp`](#commands.cursorPageUp)
export const emacsStyleKeymap: readonly KeyBinding[] = [
  {key:"Ctrl-b", run: cursorCharLeft, shift: selectCharLeft},
  {key: "Ctrl-f", run: cursorCharRight, shift: selectCharRight},

  {key: "Ctrl-p", run: cursorLineUp, shift: selectLineUp},
  {key: "Ctrl-n", run: cursorLineDown, shift: selectLineDown},

  {key: "Ctrl-a", run: cursorLineStart, shift: selectLineStart},
  {key: "Ctrl-e", run: cursorLineEnd, shift: selectLineEnd},

  {key: "Ctrl-d", run: deleteCharForward},
  {key: "Ctrl-h", run: deleteCharBackward},
  {key: "Ctrl-k", run: deleteToLineEnd},
  {key: "Alt-d", run: deleteGroupForward},
  {key: "Ctrl-Alt-h", run: deleteGroupBackward},

  {key: "Ctrl-o", run: splitLine},
  {key: "Ctrl-t", run: transposeChars},

  {key: "Alt-f", run: cursorGroupForward, shift: selectGroupForward},
  {key: "Alt-b", run: cursorGroupBackward, shift: selectGroupBackward},

  {key: "Alt-<", run: cursorDocStart},
  {key: "Alt->", run: cursorDocEnd},

  {key: "Ctrl-v", run: cursorPageDown},
  {key: "Alt-v", run: cursorPageUp},
]

/// An array of key bindings closely sticking to platform-standard or
/// widely used bindings. (This includes the bindings from
/// [`emacsStyleKeymap`](#commands.emacsStyleKeymap), with their `key`
/// property changed to `mac`.)
///
///  - ArrowLeft: [`cursorCharLeft`](#commands.cursorCharLeft) ([`selectCharLeft`](#commands.selectCharLeft) with Shift)
///  - ArrowRight: [`cursorCharRight`](#commands.cursorCharRight) ([`selectCharRight`](#commands.selectCharRight) with Shift)
///  - Ctrl-ArrowLeft (Alt-ArrowLeft on macOS): [`cursorGroupLeft`](#commands.cursorGroupLeft) ([`selectGroupLeft`](#commands.selectGroupLeft) with Shift)
///  - Ctrl-ArrowRight (Alt-ArrowRight on macOS): [`cursorGroupRight`](#commands.cursorGroupRight) ([`selectGroupRight`](#commands.selectGroupRight) with Shift)
///  - Cmd-ArrowLeft (on macOS): [`cursorLineStart`](#commands.cursorLineStart) ([`selectLineStart`](#commands.selectLineStart) with Shift)
///  - Cmd-ArrowRight (on macOS): [`cursorLineEnd`](#commands.cursorLineEnd) ([`selectLineEnd`](#commands.selectLineEnd) with Shift)
///  - ArrowUp: [`cursorLineUp`](#commands.cursorLineUp) ([`selectLineUp`](#commands.selectLineUp) with Shift)
///  - ArrowDown: [`cursorLineDown`](#commands.cursorLineDown) ([`selectLineDown`](#commands.selectLineDown) with Shift)
///  - Cmd-ArrowUp (on macOS): [`cursorDocStart`](#commands.cursorDocStart) ([`selectDocStart`](#commands.selectDocStart) with Shift)
///  - Cmd-ArrowDown (on macOS): [`cursorDocEnd`](#commands.cursorDocEnd) ([`selectDocEnd`](#commands.selectDocEnd) with Shift)
///  - Ctrl-ArrowUp (on macOS): [`cursorPageUp`](#commands.cursorPageUp) ([`selectPageUp`](#commands.selectPageUp) with Shift)
///  - Ctrl-ArrowDown (on macOS): [`cursorPageDown`](#commands.cursorPageDown) ([`selectPageDown`](#commands.selectPageDown) with Shift)
///  - PageUp: [`cursorPageUp`](#commands.cursorPageUp) ([`selectPageUp`](#commands.selectPageUp) with Shift)
///  - PageDown: [`cursorPageDown`](#commands.cursorPageDown) ([`selectPageDown`](#commands.selectPageDown) with Shift)
///  - Home: [`cursorLineBoundaryBackward`](#commands.cursorLineBoundaryBackward) ([`selectLineBoundaryBackward`](#commands.selectLineBoundaryBackward) with Shift)
///  - End: [`cursorLineBoundaryForward`](#commands.cursorLineBoundaryForward) ([`selectLineBoundaryForward`](#commands.selectLineBoundaryForward) with Shift)
///  - Ctrl-Home (Cmd-Home on macOS): [`cursorDocStart`](#commands.cursorDocStart) ([`selectDocStart`](#commands.selectDocStart) with Shift)
///  - Ctrl-End (Cmd-Home on macOS): [`cursorDocEnd`](#commands.cursorDocEnd) ([`selectDocEnd`](#commands.selectDocEnd) with Shift)
///  - Enter: [`insertNewlineAndIndent`](#commands.insertNewlineAndIndent)
///  - Ctrl-a (Cmd-a on macOS): [`selectAll`](#commands.selectAll)
///  - Backspace: [`deleteCharBackward`](#commands.deleteCharBackward)
///  - Delete: [`deleteCharForward`](#commands.deleteCharForward)
///  - Ctrl-Backspace (Ctrl-Alt-Backspace on macOS): [`deleteGroupBackward`](#commands.deleteGroupBackward)
///  - Ctrl-Delete (Alt-Backspace and Alt-Delete on macOS): [`deleteGroupForward`](#commands.deleteGroupForward)
export const standardKeymap: readonly KeyBinding[] = ([
  {key: "ArrowLeft", run: cursorCharLeft, shift: selectCharLeft},
  {key: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", run: cursorGroupLeft, shift: selectGroupLeft},
  {mac: "Cmd-ArrowLeft", run: cursorLineStart, shift: selectLineStart},

  {key: "ArrowRight", run: cursorCharRight, shift: selectCharRight},
  {key: "Mod-ArrowRight", mac: "Alt-ArrowRight", run: cursorGroupRight, shift: selectGroupRight},
  {mac: "Cmd-ArrowRight", run: cursorLineEnd, shift: selectLineEnd},

  {key: "ArrowUp", run: cursorLineUp, shift: selectLineUp},
  {mac: "Cmd-ArrowUp", run: cursorDocStart, shift: selectDocStart},
  {mac: "Ctrl-ArrowUp", run: cursorPageUp, shift: selectPageUp},

  {key: "ArrowDown", run: cursorLineDown, shift: selectLineDown},
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

  {key: "Backspace", run: deleteCharBackward},
  {key: "Delete", run: deleteCharForward},
  {key: "Mod-Backspace", mac: "Ctrl-Alt-Backspace", run: deleteGroupBackward},
  {key: "Mod-Delete", mac: "Alt-Backspace", run: deleteGroupForward},

  {mac: "Alt-Delete", run: deleteGroupForward},
] as KeyBinding[]).concat(emacsStyleKeymap.map(b => ({mac: b.key, run: b.run, shift: b.shift})))

/// The default keymap. Includes all bindings from
/// [`standardKeymap`](#commands.standardKeymap) plus the following:
///
/// - Alt-ArrowLeft (Ctrl-ArrowLeft on macOS): [`cursorSyntaxLeft`](#commands.cursorSyntaxLeft) ([`selectSyntaxLeft`](#commands.selectSyntaxLeft) with Shift)
/// - Alt-ArrowRight (Ctrl-ArrowRight on macOS): [`cursorSyntaxRight`](#commands.cursorSyntaxRight) ([`selectSyntaxRight`](#commands.selectSyntaxRight) with Shift)
/// - Alt-ArrowUp: [`moveLineUp`](#commands.moveLineUp)
/// - Alt-ArrowDown: [`moveLineDown`](#commands.moveLineDown)
/// - Shift-Alt-ArrowUp: [`copyLineUp`](#commands.copyLineUp)
/// - Shift-Alt-ArrowDown: [`copyLineDown`](#commands.copyLineDown)
/// - Escape: [`simplifySelection`](#commands.simplifySelection)
/// - Ctrl-l (Cmd-l on macOS): [`selectLine`](#commands.selectLine)
/// - Ctrl-i (Cmd-i on macOS): [`selectParentSyntax`](#commands.selectParentSyntax)
/// - Ctrl-[ (Cmd-[ on macOS): [`indentLess`](#commands.indentLess)
/// - Ctrl-] (Cmd-] on macOS): [`indentMore`](#commands.indentMore)
/// - Ctrl-Alt-\\ (Cmd-Alt-\\ on macOS): [`indentSelection`](#commands.indentSelection)
/// - Shift-Ctrl-k (Shift-Cmd-k on macOS): [`deleteLine`](#commands.deleteLine)
/// - Shift-Ctrl-\\ (Shift-Cmd-\\ on macOS): [`cursorMatchingBracket`](#commands.cursorMatchingBracket)
export const defaultKeymap: readonly KeyBinding[] = ([
  {key: "Alt-ArrowLeft", mac: "Ctrl-ArrowLeft", run: cursorSyntaxLeft, shift: selectSyntaxLeft},
  {key: "Alt-ArrowRight", mac: "Ctrl-ArrowRight", run: cursorSyntaxRight, shift: selectSyntaxRight},

  {key: "Alt-ArrowUp", run: moveLineUp},
  {key: "Shift-Alt-ArrowUp", run: copyLineUp},

  {key: "Alt-ArrowDown", run: moveLineDown},
  {key: "Shift-Alt-ArrowDown", run: copyLineDown},

  {key: "Escape", run: simplifySelection},

  {key: "Mod-l", run: selectLine},
  {key: "Mod-i", run: selectParentSyntax},

  {key: "Mod-[", run: indentLess},
  {key: "Mod-]", run: indentMore},
  {key: "Mod-Alt-\\", run: indentSelection},

  {key: "Shift-Mod-k", run: deleteLine},

  {key: "Shift-Mod-\\", run: cursorMatchingBracket}
] as readonly KeyBinding[]).concat(standardKeymap)
