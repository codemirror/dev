import {EditorState, EditorSelection, SelectionRange, StateExtension, Transaction} from "../../state/src"
import {EditorView} from "../../view/src"

export type Command = (view: EditorView) => boolean

function moveSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                       granularity: "character" | "word" | "line" | "lineboundary"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    if (!range.empty && granularity != "lineboundary")
      return new SelectionRange(dir == "left" || dir == "backward" ? range.from : range.to)
    return new SelectionRange(view.movePos(range.head, dir, granularity, "move"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction = transaction.addSlot(Transaction.preserveGoalColumn(true))
  view.dispatch(transaction.scrollIntoView())
  return true
}

export const moveCharLeft: Command = view => moveSelection(view, "left", "character")
export const moveCharRight: Command = view => moveSelection(view, "right", "character")

export const moveWordLeft: Command = view => moveSelection(view, "left", "word")
export const moveWordRight: Command = view => moveSelection(view, "right", "word")

export const moveLineUp: Command = view => moveSelection(view, "backward", "line")
export const moveLineDown: Command = view => moveSelection(view, "forward", "line")

export const moveLineStart: Command = view => moveSelection(view, "backward", "lineboundary")
export const moveLineEnd: Command = view => moveSelection(view, "forward", "lineboundary")

function extendSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                         granularity: "character" | "word" | "line" | "lineboundary"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    return new SelectionRange(range.anchor, view.movePos(range.head, dir, granularity, "extend"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction = transaction.addSlot(Transaction.preserveGoalColumn(true))
  view.dispatch(transaction.scrollIntoView())
  return true
}

export const extendCharLeft: Command = view => extendSelection(view, "left", "character")
export const extendCharRight: Command = view => extendSelection(view, "right", "character")

export const extendWordLeft: Command = view => extendSelection(view, "left", "word")
export const extendWordRight: Command = view => extendSelection(view, "right", "word")

export const extendLineUp: Command = view => extendSelection(view, "backward", "line")
export const extendLineDown: Command = view => extendSelection(view, "forward", "line")

export const extendLineStart: Command = view => extendSelection(view, "backward", "lineboundary")
export const extendLineEnd: Command = view => extendSelection(view, "forward", "lineboundary")

export const selectDocStart: Command = ({state, dispatch}) => {
  dispatch(state.transaction.setSelection(EditorSelection.single(0)).scrollIntoView())
  return true
}

export const selectDocEnd: Command = ({state, dispatch}) => {
  dispatch(state.transaction.setSelection(EditorSelection.single(state.doc.length)).scrollIntoView())
  return true
}

export const selectAll: Command = ({state, dispatch}) => {
  dispatch(state.transaction.setSelection(EditorSelection.single(0, state.doc.length)))
  return true
}

function deleteText(view: EditorView, dir: "forward" | "backward") {
  let transaction = view.state.transaction.reduceRanges((transaction, range) => {
    let {from, to} = range
    if (from == to) {
      let target = view.movePos(range.head, dir, "character", "move")
      from = Math.min(from, target); to = Math.max(to, target)
    }
    if (from == to) return {transaction, range}
    return {transaction: transaction.replace(from, to, ""),
            range: new SelectionRange(from)}
  })
  if (!transaction.docChanged) return false

  view.dispatch(transaction.scrollIntoView())
  return true
}

export const deleteCharBackward: Command = view => deleteText(view, "backward")
export const deleteCharForward: Command = view => deleteText(view, "forward")

// FIXME support indenting by tab, configurable indent units

function space(n: number) {
  let result = ""
  for (let i = 0; i < n; i++) result += " "
  return result
}

function getIndentation(state: EditorState, pos: number): number {
  for (let f of state.behavior.get(StateExtension.indentation)) {
    let result = f(state, pos)
    if (result > -1) return result
  }
  return -1
}

export function insertNewlineAndIndent({state, dispatch}: EditorView): boolean {
  let indentation = state.selection.ranges.map(r => getIndentation(state, r.from)), i = 0
  dispatch(state.transaction.reduceRanges((tr, range) => {
    let indent = indentation[i++]
    return {transaction: tr.replace(range.from, range.to, ["", space(indent)]),
            range: new SelectionRange(range.from + indent + 1)}
  }).scrollIntoView())
  return true
}

export function indentSelection({state, dispatch}: EditorView): boolean {
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
    let tr = state.transaction
    for (let {pos, current, indent} of positions) {
      let start = tr.changes.mapPos(pos)
      tr = tr.replace(start, start + current, space(indent))
    }
    dispatch(tr)
  }
  return true
}

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

declare global { const os: any }
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

export const baseKeymap: {[key: string]: Command} = mac ? macBaseKeymap : pcBaseKeymap
