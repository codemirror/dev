import {EditorSelection, SelectionRange, MetaSlot} from "../../state/src"
import {EditorView} from "../../view/src"

export type Command = (view: EditorView) => boolean

function moveSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                       granularity: "character" | "line" | "lineboundary"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    if (!range.empty && granularity != "lineboundary")
      return new SelectionRange(dir == "left" || dir == "backward" ? range.from : range.to)
    return new SelectionRange(view.movePos(range.head, dir, granularity, "move"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction = transaction.setMeta(MetaSlot.preserveGoalColumn, true)
  view.dispatch(transaction.scrollIntoView())
  return true
}

export const moveCharLeft: Command = view => moveSelection(view, "left", "character")
export const moveCharRight: Command = view => moveSelection(view, "right", "character")

export const moveLineUp: Command = view => moveSelection(view, "backward", "line")
export const moveLineDown: Command = view => moveSelection(view, "forward", "line")

export const moveLineStart: Command = view => moveSelection(view, "backward", "lineboundary")
export const moveLineEnd: Command = view => moveSelection(view, "forward", "lineboundary")

function extendSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                         granularity: "character" | "line" | "lineboundary"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    return new SelectionRange(range.anchor, view.movePos(range.head, dir, granularity, "extend"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction = transaction.setMeta(MetaSlot.preserveGoalColumn, true)
  view.dispatch(transaction.scrollIntoView())
  return true
}

export const extendCharLeft: Command = view => extendSelection(view, "left", "character")
export const extendCharRight: Command = view => extendSelection(view, "right", "character")

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

export const pcBaseKeymap: {[key: string]: Command} = {
  "ArrowLeft": moveCharLeft,
  "ArrowRight": moveCharRight,
  "Shift-ArrowLeft": extendCharLeft,
  "Shift-ArrowRight": extendCharRight,
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
  "Delete": deleteCharForward
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
