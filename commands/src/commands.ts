import {EditorSelection, SelectionRange} from "../../state/src"
import {EditorView} from "../../view/src"

export type Command = (view: EditorView) => boolean

// FIXME multiple cursors
// FIXME meta properties

function moveChar(view: EditorView, dir: "left" | "right"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    if (!range.empty) return new SelectionRange(dir == "left" ? range.from : range.to)
    return new SelectionRange(view.findPosH(range.head, dir, "character", "move"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  view.dispatch(transaction)
  return true
}

export const moveCharLeft: Command = (view: EditorView) => moveChar(view, "left")
export const moveCharRight: Command = (view: EditorView) => moveChar(view, "right")

function extendChar(view: EditorView, dir: "left" | "right"): boolean {
  let transaction = view.state.transaction.mapRanges(range => {
    return new SelectionRange(range.anchor, view.findPosH(range.head, dir, "character", "extend"))
  })
  if (transaction.selection.eq(view.state.selection)) return false
  view.dispatch(transaction)
  return true
}

export const extendCharLeft: Command = (view: EditorView) => extendChar(view, "left")
export const extendCharRight: Command = (view: EditorView) => extendChar(view, "right")

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
  "Mod-Home": selectDocStart,
  "Mod-End": selectDocEnd,
  "Mod-a": selectAll
}

export const macBaseKeymap: {[key: string]: Command} = {
  "Cmd-ArrowUp": selectDocStart,
  "Cmd-ArrowDown": selectDocEnd
}
for (let key in pcBaseKeymap) macBaseKeymap[key] = pcBaseKeymap[key]

declare global { const os: any }
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

export const baseKeymap: {[key: string]: Command} = mac ? macBaseKeymap : pcBaseKeymap
