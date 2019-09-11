const ist = require("ist")

import {EditorState, EditorSelection, SelectionRange, Transaction} from "../../state/src"
import {closeHistory, history, redo, redoDepth, redoSelection, undo, undoDepth,
        undoSelection} from "../src/history"

const mkState = (config?: any, doc?: string) => EditorState.create({
  extensions: [history(config), EditorState.allowMultipleSelections(true)],
  doc
})

const type = (state: EditorState, text: string, at = state.doc.length) => state.t().replace(at, at, text).apply()
const timedType = (state: EditorState, text: string, atTime: number) => state.t(atTime).replace(state.doc.length, state.doc.length, text).apply()
const receive = (state: EditorState, text: string, from: number, to = from) => {
  return state.t().replace(from, to, text).addMeta(Transaction.addToHistory(false)).apply()
}
const command = (state: EditorState, cmd: any, success: boolean = true) => {
  ist(cmd({state, dispatch(tr: Transaction) { state = tr.apply() }}), success)
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

  it("doesn't get confused by an undo not adding any redo item", () => {
    let state = mkState({}, "ab")
    state = type(state, "cd", 1)
    state = receive(state, "123", 0, 4)
    state = command(state, undo)
    ist(command(state, redo, false))
  })

  it("accurately maps changes through each other", () => {
    let state = mkState({}, "123")
    state = state.t().replace(1, 2, "cd").replace(3, 4, "ef").replace(0, 1, "ab").apply()
    state = receive(state, "!!!!!!!!", 2, 2)
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.toString(), "ab!!!!!!!!cdef")
  })

  function unsyncedComplex(state: EditorState) {
    state = type(state, "hello")
    state = closeHistory(state.t()).apply()
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
    unsyncedComplex(mkState())
  })

  it("supports overlapping edits", () => {
    let state = mkState()
    state = type(state, "hello")
    state = closeHistory(state.t()).apply()
    state = state.t().replace(0, 5, "").apply()
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
    state = closeHistory(state.t()).apply()
    state = state.t().replace(0, 5, "").apply()
    ist(state.doc.toString(), "")
    state = command(state, undo)
    ist(state.doc.toString(), "hello")
    state = command(state, undo)
    ist(state.doc.toString(), "h")
  })

  it("supports overlapping unsynced deletes", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.t()).apply()
    state = type(state, "hello")
    state = state.t().replace(0, 7, "").addMeta(Transaction.addToHistory(false)).apply()
    ist(state.doc.toString(), "")
    state = command(state, undo)
    ist(state.doc.toString(), "")
  })

  it("can go back and forth through history multiple times", () => {
    let state = mkState()
    state = type(state, "one")
    state = type(state, " two")
    state = closeHistory(state.t()).apply()
    state = type(state, " three")
    state = type(state, "zero ", 0)
    state = closeHistory(state.t()).apply()
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
    state = closeHistory(state.t()).apply()
    state = receive(state, "xxx", state.doc.length)
    state = type(state, " three")
    state = type(state, "zero ", 0)
    state = closeHistory(state.t()).apply()
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

  it("restores selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.t()).apply()
    state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
    const selection = state.selection
    state = state.t().replaceSelection("hello").apply()
    const selection2 = state.selection
    state = command(state, undo)
    ist(state.selection.eq(selection))
    state = command(state, redo)
    ist(state.selection.eq(selection2))
  })

  it("restores the selection before the first change in an item (#46)", () => {
    let state = mkState()
    state = state.t().replace(0, 0, "a").setSelection(EditorSelection.single(1)).apply()
    state = state.t().replace(1, 1, "b").setSelection(EditorSelection.single(2)).apply()
    state = command(state, undo)
    ist(state.doc.toString(), "")
    ist(state.selection.primary.anchor, 0)
  })

  it("doesn't merge document changes if there's a selection change in between", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
    state = state.t().replaceSelection("hello").apply()
    ist(undoDepth(state), 2)
  })

  it("rebases selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.t()).apply()
    state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
    state = type(state, "hello", 0)
    state = receive(state, "---", 0)
    state = command(state, undo)
    ist(state.selection.ranges[0].head, 5)
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
    ist(command(state, undo, false))
    ist(command(state, redo, false))
  })

  it("truncates history", () => {
    let state = mkState({minDepth: 10})
    for (let i = 0; i < 40; ++i) {
      state = type(state, "a")
      state = closeHistory(state.t()).apply()
    }
    ist(undoDepth(state) < 40)
  })

  it("supports transactions with multiple changes", () => {
    let state = mkState()
    state = state.t().replace(0, 0, "a").replace(1, 1, "b").apply()
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

  it("doesn't undo selection-only transactions", () => {
    let state = mkState(undefined, "abc")
    ist(state.selection.primary.head, 0)
    state = state.t().setSelection(EditorSelection.single(2)).apply()
    state = command(state, undo, false)
    ist(state.selection.primary.head, 2)
  })

  describe("undoSelection", () => {
    it("allows to undo a change", () => {
      let state = mkState()
      state = type(state, "newtext")
      state = command(state, undoSelection)
      ist(state.doc.toString(), "")
    })

    it("allows to undo selection-only transactions", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("merges selection-only transactions from keyboard", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = state.t().setSelection(EditorSelection.single(3)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = state.t().setSelection(EditorSelection.single(1)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("doesn't merge selection-only transactions from other sources", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).apply()
      state = state.t().setSelection(EditorSelection.single(3)).apply()
      state = state.t().setSelection(EditorSelection.single(1)).apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 3)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 2)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("doesn't merge selection-only transactions if they change the number of selections", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = state.t().setSelection(EditorSelection.create([new SelectionRange(1, 1), new SelectionRange(3, 3)])).
        addMeta(Transaction.userEvent("keyboard")).apply()
      state = state.t().setSelection(EditorSelection.single(1)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = command(state, undoSelection)
      ist(state.selection.ranges.length, 2)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("doesn't merge selection-only transactions if a selection changes empty state", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = state.t().setSelection(EditorSelection.single(2, 3)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = state.t().setSelection(EditorSelection.single(1)).addMeta(Transaction.userEvent("keyboard")).apply()
      state = command(state, undoSelection)
      ist(state.selection.primary.anchor, 2)
      ist(state.selection.primary.head, 3)
      state = command(state, undoSelection)
      ist(state.selection.primary.head, 0)
    })

    it("allows to redo a change", () => {
      let state = mkState()
      state = type(state, "newtext")
      state = command(state, undoSelection)
      state = command(state, redoSelection)
      ist(state.doc.toString(), "newtext")
    })

    it("allows to redo selection-only transactions", () => {
      let state = mkState(undefined, "abc")
      ist(state.selection.primary.head, 0)
      state = state.t().setSelection(EditorSelection.single(2)).apply()
      state = command(state, undoSelection)
      state = command(state, redoSelection)
      ist(state.selection.primary.head, 2)
    })

    it("only changes selection", () => {
      let state = mkState()
      state = type(state, "hi")
      state = closeHistory(state.t()).apply()
      const selection = state.selection
      state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
      const selection2 = state.selection
      state = command(state, undoSelection)
      ist(state.selection.eq(selection))
      ist(state.doc.toString(), "hi")
      state = command(state, redoSelection)
      ist(state.selection.eq(selection2))
      state = state.t().replaceSelection("hello").apply()
      const selection3 = state.selection
      state = command(state, undoSelection)
      ist(state.selection.eq(selection2))
      state = command(state, redo)
      ist(state.selection.eq(selection3))
    })

    it("can undo a selection through remote changes", () => {
      let state = mkState()
      state = type(state, "hello")
      const selection = state.selection
      state = state.t().setSelection(EditorSelection.single(0, 2)).apply()
      state = receive(state, "oops", 0)
      state = receive(state, "!", 9)
      ist(state.selection.eq(EditorSelection.single(0, 6)))
      state = command(state, undoSelection)
      ist(state.doc.toString(), "oopshello!")
      ist(state.selection.eq(selection))
    })
  })
})
