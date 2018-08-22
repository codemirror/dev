import {EditorState, Transaction, EditorSelection} from "../../state/src"

export type Command = (state: EditorState, dispatch?: (transaction: Transaction) => void) => boolean

export const selectDocStart: Command = (state, dispatch) => {
  if (dispatch)
    dispatch(state.transaction.setSelection(EditorSelection.single(0)).scrollIntoView())
  return true
}

export const selectDocEnd: Command = (state, dispatch) => {
  if (dispatch)
    dispatch(state.transaction.setSelection(EditorSelection.single(state.doc.length)).scrollIntoView())
  return true
}

export const selectAll: Command = (state, dispatch) => {
  if (dispatch)
    dispatch(state.transaction.setSelection(EditorSelection.single(0, state.doc.length)))
  return true
}

export const pcBaseKeymap: {[key: string]: Command} = {
  "Mod-Home": selectDocStart,
  "Mod-End": selectDocEnd,
  "Mod-A": selectAll
}

export const macBaseKeymap: {[key: string]: Command} = {
  "Cmd-ArrowUp": selectDocStart,
  "Ctrl-ArrowUp": selectDocStart,
  "Cmd-ArrowDown": selectDocEnd,
  "Ctrl-ArrowDown": selectDocEnd
}
for (let key in pcBaseKeymap) macBaseKeymap[key] = pcBaseKeymap[key]

declare global { const os: any }
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

export const baseKeymap: {[key: string]: Command} = mac ? macBaseKeymap : pcBaseKeymap
