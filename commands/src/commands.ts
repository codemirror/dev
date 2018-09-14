import {EditorSelection, SelectionRange, MetaSlot} from "../../state/src"
import {EditorView} from "../../view/src"

export type Command = (view: EditorView) => boolean

// FIXME multiple cursors
// FIXME meta properties

function moveSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                       granularity: "character" | "line" | "lineboundary"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    if (!range.empty) return new SelectionRange(dir == "left" || dir == "backward" ? range.from : range.to)
    return new SelectionRange(view.movePos(range.head, dir, granularity, "move"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction = transaction.setMeta(MetaSlot.preserveGoalColumn, true)
  view.dispatch(transaction)
  return true
}

export const moveCharLeft: Command = (view: EditorView) => moveSelection(view, "left", "character")
export const moveCharRight: Command = (view: EditorView) => moveSelection(view, "right", "character")

export const moveLineUp: Command = (view: EditorView) => moveSelection(view, "backward", "line")
export const moveLineDown: Command = (view: EditorView) => moveSelection(view, "forward", "line")

export const moveLineStart: Command = (view: EditorView) => moveSelection(view, "backward", "lineboundary")
export const moveLineEnd: Command = (view: EditorView) => moveSelection(view, "forward", "lineboundary")

function extendSelection(view: EditorView, dir: "left" | "right" | "forward" | "backward",
                         granularity: "character" | "line" | "lineboundary"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    return new SelectionRange(range.anchor, view.movePos(range.head, dir, granularity, "extend"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  if (granularity == "line") transaction = transaction.setMeta(MetaSlot.preserveGoalColumn, true)
  view.dispatch(transaction)
  return true
}

export const extendCharLeft: Command = (view: EditorView) => extendSelection(view, "left", "character")
export const extendCharRight: Command = (view: EditorView) => extendSelection(view, "right", "character")

export const extendLineUp: Command = (view: EditorView) => extendSelection(view, "backward", "line")
export const extendLineDown: Command = (view: EditorView) => extendSelection(view, "forward", "line")

export const extendLineStart: Command = (view: EditorView) => extendSelection(view, "backward", "lineboundary")
export const extendLineEnd: Command = (view: EditorView) => extendSelection(view, "forward", "lineboundary")

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
  "Mod-a": selectAll
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
  "Cmd-ArrowDown": selectDocEnd
}
for (let key in pcBaseKeymap) macBaseKeymap[key] = pcBaseKeymap[key]

declare global { const os: any }
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

export const baseKeymap: {[key: string]: Command} = mac ? macBaseKeymap : pcBaseKeymap
