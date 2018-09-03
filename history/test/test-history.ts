const ist = require("ist")

import {Change, ChangeSet, EditorState, EditorSelection, Transaction, MetaSlot} from "../../state/src"
import {closeHistory, history, redo, redoDepth, undo, undoDepth} from "../src/history"

const mkState = (config?: any, doc?: string) => EditorState.create({plugins: [history(config)], doc})

const type = (state: EditorState, text: string, at = state.doc.length) => state.transaction.replace(at, at, text).apply()
const timedType = (state: EditorState, text: string, atTime: number) => Transaction.start(state, atTime).replace(state.doc.length, state.doc.length, text).apply()
const receive = (state: EditorState, text: string, from: number, to = from) => state.transaction.replace(from, to, text).setMeta(MetaSlot.addToHistory, false).apply()
const command = (state: EditorState, cmd: any) => {
  ist(cmd(state, (tr: Transaction) => state = tr.apply()), true)
  return state
}

describe("history", () => {
  it("allows to undo a change", () => {
    let state = mkState()
    state = type(state, "newtext")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("allows to undo nearby changes in one change", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("allows to redo a change", () => {
    let state = mkState()
    state = type(state, "newtext")
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.toString(), "newtext")
  })

  it("allows to redo nearby changes in one change", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.toString(), "newtext")
  })

  it("tracks multiple levels of history", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = type(state, "some", 0)
    ist(state.doc.toString(), "somenewtext")
    state = command(state, undo)
    ist(state.doc.toString(), "newtext")
    state = command(state, undo)
    ist(state.doc.toString(), "")
    state = command(state, redo)
    ist(state.doc.toString(), "newtext")
    state = command(state, redo)
    ist(state.doc.toString(), "somenewtext")
    state = command(state, undo)
    ist(state.doc.toString(), "newtext")
  })

  it("starts a new event when newGroupDelay elapses", () => {
    let state = mkState({newGroupDelay: 1000})
    state = timedType(state, "a", 1000)
    state = timedType(state, "b", 1600)
    ist(undoDepth(state), 1)
    state = timedType(state, "c", 2700)
    ist(undoDepth(state), 2)
    state = command(state, undo)
    state = timedType(state, "d", 2800)
    ist(undoDepth(state), 2)
  })

  it("allows changes that aren't part of the history", () => {
    let state = mkState()
    state = type(state, "hello")
    state = receive(state, "oops", 0)
    state = receive(state, "!", 9)
    state = command(state, undo)
    ist(state.doc.toString(), "oops!")
  })

  // FIXME figure out why a change isn't mapped away by directly overwriting change
  it("doesn't get confused by an undo not adding any redo item", () => {
    let state = mkState({}, "ab")
    state = type(state, "cd", 1)
    state = receive(state, "123", 0, 4)
    state = command(state, undo)
    ist(redo(state), false)
  })

  it("accurately maps changes through each other", () => {
    let state = mkState({}, "123")
    state = state.transaction.replace(1, 2, "cd").replace(3, 4, "ef").replace(0, 1, "ab").apply()
    state = receive(state, "!!!!!!!!", 2, 2)
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.toString(), "ab!!!!!!!!cdef")
  })

  function unsyncedComplex(state: EditorState) {
    state = type(state, "hello")
    state = closeHistory(state.transaction).apply()
    state = type(state, "!")
    state = receive(state, "....", 0)
    state = type(state, "\n\n", 2)
    ist(state.doc.toString(), "..\n\n..hello!")
    state = receive(state, "\n\n", 1)
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc.toString(), ".\n\n...hello")
    state = command(state, undo)
    ist(state.doc.toString(), ".\n\n...")
  }

  it("can handle complex editing sequences", () => {
    unsyncedComplex(mkState(), false)
  })

  it("supports overlapping edits", () => {
    let state = mkState()
    state = type(state, "hello")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.replace(0, 5, "").apply()
    ist(state.doc.toString(), "")
    state = command(state, undo)
    ist(state.doc.toString(), "hello")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("supports overlapping edits that aren't collapsed", () => {
    let state = mkState()
    state = receive(state, "h", 0)
    state = type(state, "ello")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.replace(0, 5, "").apply()
    ist(state.doc.toString(), "")
    state = command(state, undo)
    ist(state.doc.toString(), "hello")
    state = command(state, undo)
    ist(state.doc.toString(), "h")
  })

  it("supports overlapping unsynced deletes", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.transaction).apply()
    state = type(state, "hello")
    state = state.transaction.replace(0, 7, "").setMeta(MetaSlot.addToHistory, false).apply()
    ist(state.doc.toString(), "")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("can go back and forth through history multiple times", () => {
    let state = mkState()
    state = type(state, "one")
    state = type(state, " two")
    state = closeHistory(state.transaction).apply()
    state = type(state, " three")
    state = type(state, "zero ", 0)
    state = closeHistory(state.transaction).apply()
    state = type(state, "\n\n", 0)
    state = type(state, "top", 0)
    for (let i = 0; i < 6; i++) {
      let re = i % 2
      for (let j = 0; j < 4; j++) state = command(state, re ? redo : undo)
      ist(state.doc.toString(), re ? "top\n\nzero one two three" : "")
    }
  })

  it("supports non-tracked changes next to tracked changes", () => {
    let state = mkState()
    state = type(state, "o")
    state = type(state, "\n\n", 0)
    state = receive(state, "zzz", 3)
    state = command(state, undo)
    ist(state.doc.toString(), "zzz")
  })

  it("can go back and forth through history when preserving items", () => {
    let state = mkState()
    state = type(state, "one")
    state = type(state, " two")
    state = closeHistory(state.transaction).apply()
    state = receive(state, "xxx", state.doc.length)
    state = type(state, " three")
    state = type(state, "zero ", 0)
    state = closeHistory(state.transaction).apply()
    state = type(state, "\n\n", 0)
    state = type(state, "top", 0)
    state = receive(state, "yyy", 0)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) state = command(state, undo)
      ist(state.doc.toString(), "yyyxxx")
      for (let j = 0; j < 4; j++) state = command(state, redo)
      ist(state.doc.toString(), "yyytop\n\nzero one twoxxx three")
    }
  })

  it.skip("restores selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.setSelection(EditorSelection.single(0, 2)).apply()
    const selection = state.selection
    state = state.transaction.replaceSelection("hello").apply()
    const selection2 = state.selection
    state = command(state, undo)
    ist(state.selection.eq(selection))
    state = command(state, redo)
    ist(state.selection.eq(selection2))
  })

  it("rebases selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.setSelection(EditorSelection.single(0, 2)).apply()
    state = type(state, "hello", 0)
    state = receive(state, "---", 0)
    state = command(state, undo)
    ist(state.selection.ranges[0].head, 5)
  })

  it.skip("handles change overwriting in item-preserving mode", () => {
    let state = mkState({preserveItems: true})
    state = type(state, "a")
    state = type(state, "b")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.setSelection(EditorSelection.single(0, 2)).apply()
    state = type(state, "c")
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("supports querying for the undo and redo depth", () => {
    let state = mkState()
    state = type(state, "a")
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
    state = receive(state, "b", 0)
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
    state = command(state, undo)
    ist(undoDepth(state), 0)
    ist(redoDepth(state), 1)
    state = command(state, redo)
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
  })

  it("all functions gracefully handle EditorStates without history", () => {
    let state = EditorState.create()
    ist(undoDepth(state), 0)
    ist(redoDepth(state), 0)
    ist(undo(state), false)
    ist(redo(state), false)
  })

  it("truncates history", () => {
    let state = mkState({minDepth: 10})
    for (let i = 0; i < 40; ++i) {
      state = type(state, "a")
      state = closeHistory(state.transaction).apply()
    }
    ist(undoDepth(state) < 40)
  })

  it("supports transactions with multiple changes", () => {
    let state = mkState()
    state = state.transaction.replace(0, 0, "a").replace(1, 1, "b").apply()
    state = type(state, "c", 0)
    ist(state.doc.toString(), "cab")
    state = command(state, undo)
    ist(state.doc.toString(), "ab")
    state = command(state, undo)
    ist(state.doc.toString(), "")
    state = command(state, redo)
    ist(state.doc.toString(), "ab")
    state = command(state, redo)
    ist(state.doc.toString(), "cab")
    state = command(state, undo)
    ist(state.doc.toString(), "ab")
  })
})
