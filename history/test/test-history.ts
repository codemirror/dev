const ist = require("ist")

import {Mapping, StepMap} from "prosemirror-transform"

import {Change, EditorState, Range, Selection, Transaction, MetaSlot} from "../../state/src/state"
import {closeHistory, history, redo, redoDepth, undo, undoDepth} from "../src/history"

const mkState = (config?) => EditorState.create({plugins: [history(config)]})

const type = (state, text, at = state.doc.length) => state.transaction.replace(at, at, text).apply()
const timedType = (state, text, atTime) => Transaction.start(state, atTime).replace(state.doc.length, state.doc.length, text).apply()
const receive = (state, text, from, to = from) => state.transaction.replace(from, to, text).setMeta(MetaSlot.addToHistory, false).apply()
const command = (state, cmd) => {
  ist(cmd(state, tr => state = tr.apply()), true)
  return state
}

const compress = state => {
  state.$historyState.done = state.$historyState.done.compress()
  return state
}

describe("history", () => {
  it("historyStateField can be used in an EditorState", () => {
    mkState()
  })

  it("historyStateField.init returns a HistoryState object", () => {
    ist(history().stateField.init())
  })

  it("allows to undo a change", () => {
    let state = mkState()
    state = type(state, "newtext")
    state = command(state, undo)
    ist(state.doc.text, "")
  })

  it("allows to undo nearby changes in one change", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = command(state, undo)
    ist(state.doc.text, "")
  })

  it("allows to redo a change", () => {
    let state = mkState()
    state = type(state, "newtext")
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.text, "newtext")
  })

  it("allows to redo nearby changes in one change", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc.text, "newtext")
  })

  it("tracks multiple levels of history", () => {
    let state = mkState()
    state = type(state, "new")
    state = type(state, "text")
    state = type(state, "some", 0)
    ist(state.doc.text, "somenewtext")
    state = command(state, undo)
    ist(state.doc.text, "newtext")
    state = command(state, undo)
    ist(state.doc.text, "")
    state = command(state, redo)
    ist(state.doc.text, "newtext")
    state = command(state, redo)
    ist(state.doc.text, "somenewtext")
    state = command(state, undo)
    ist(state.doc.text, "newtext")
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
    ist(state.doc.text, "oops!")
  })

  it("doesn't get confused by an undo not adding any redo item", () => {
    let state = mkState()
    state = type(state, "foo")
    state = receive(state, "bar", 0, 3)
    state = command(state, undo)
    ist(redo(state), false)
  })

  function unsyncedComplex(state, doCompress) {
    state = type(state, "hello")
    state = closeHistory(state.transaction).apply()
    state = type(state, "!")
    state = receive(state, "....", 0)
    state = type(state, "\n\n", 2)
    ist(state.doc.text, "..\n\n..hello!")
    state = receive(state, "\n\n", 1)
    if (doCompress) compress(state)
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc.text, ".\n\n...hello")
    state = command(state, undo)
    ist(state.doc.text, ".\n\n...")
  }

  it("can handle complex editing sequences", () => {
    unsyncedComplex(mkState(), false)
  })

  it("can handle complex editing sequences with compression", () => {
    unsyncedComplex(mkState(), true)
  })

  it("supports overlapping edits", () => {
    let state = mkState()
    state = type(state, "hello")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.replace(0, 5, "").apply()
    ist(state.doc.text, "")
    state = command(state, undo)
    ist(state.doc.text, "hello")
    state = command(state, undo)
    ist(state.doc.text, "")
  })

  it("supports overlapping edits that aren't collapsed", () => {
    let state = mkState()
    state = receive(state, "h", 0)
    state = type(state, "ello")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.replace(0, 5, "").apply()
    ist(state.doc.text, "")
    state = command(state, undo)
    ist(state.doc.text, "hello")
    state = command(state, undo)
    ist(state.doc.text, "h")
  })

  it("supports overlapping unsynced deletes", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.transaction).apply()
    state = type(state, "hello")
    state = state.transaction.replace(0, 7, "").setMeta(MetaSlot.addToHistory, false).apply()
    ist(state.doc.text, "")
    state = command(state, undo)
    ist(state.doc.text, "")
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
      ist(state.doc.text, re ? "top\n\nzero one two three" : "")
    }
  })

  it("supports non-tracked changes next to tracked changes", () => {
    let state = mkState()
    state = type(state, "o")
    state = type(state, "\n\n", 0)
    state = receive(state, "zzz", 3)
    state = command(state, undo)
    ist(state.doc.text, "zzz")
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
      if (i == 2) compress(state)
      for (let j = 0; j < 4; j++) state = command(state, undo)
      ist(state.doc.text, "yyyxxx")
      for (let j = 0; j < 4; j++) state = command(state, redo)
      ist(state.doc.text, "yyytop\n\nzero one twoxxx three")
    }
  })

  it("restores selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = closeHistory(state.transaction).apply()
    state = state.transaction.setSelection(new Selection([new Range(0, 2)])).apply()
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
    state = state.transaction.setSelection(new Selection([new Range(0, 2)])).apply()
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
    state = state.transaction.setSelection(new Selection([new Range(0, 2)])).apply()
    state = type(state, "c")
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc.text, "")
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

  it.skip("truncates history", () => {
    let state = mkState({depth: 2})
    for (let i = 1; i < 40; ++i) {
      state = type(state, "a")
      state = closeHistory(state.transaction).apply()
      ist(undoDepth(state), (i - 2) % 21 + 2)
    }
  })

  it("supports transactions with multiple changes", () => {
    let state = mkState()
    state = state.transaction.replace(0, 0, "a").replace(1, 1, "b").apply()
    state = type(state, "c", 0)
    ist(state.doc.text, "cab")
    state = command(state, undo)
    ist(state.doc.text, "ab")
    state = command(state, undo)
    ist(state.doc.text, "")
    state = command(state, redo)
    ist(state.doc.text, "ab")
    state = command(state, redo)
    ist(state.doc.text, "cab")
    state = command(state, undo)
    ist(state.doc.text, "ab")
  })

  it("supports rebasing", () => {
    // This test simulates a collab editing session where the local editor
    // receives a change (`right`) that's on top of the parent change (`base`) of
    // the last local change (`left`).

    // Shared base change
    let state = mkState()
    state = type(state, "base")
    state = closeHistory(state.transaction).apply()
    const baseDoc = state.doc

    // Local unconfirmed change
    //
    //        - left
    //       /
    // base -
    //       \
    //        - right
    let rightChange = new Change(4, 4, " right")
    state = state.transaction.change(rightChange).apply()
    ist(state.doc.text, "base right")
    ist(undoDepth(state), 2)
    let leftChange = new Change(0, 0, "left ")

    // Receive remote change and rebase local unconfirmed change
    //
    // base --> left --> right'
    let tr = state.transaction
    tr = tr.change(rightChange.invert(baseDoc))
    tr = tr.change(leftChange)
    tr = tr.change(new Change(leftChange.mapPos(rightChange.from, 1), leftChange.mapPos(rightChange.to, -1), rightChange.text))

    function getStepMap(change: Change) {
      return new StepMap([change.from, change.to - change.from, change.text.length])
    }
    const mapping = new Mapping()
    mapping.appendMap(getStepMap(rightChange.invert(baseDoc)))
    mapping.appendMap(getStepMap(leftChange))
    mapping.appendMap(getStepMap(new Change(leftChange.mapPos(rightChange.from, 1), leftChange.mapPos(rightChange.to, -1), rightChange.text)), 0)

    tr = tr.setMeta(MetaSlot.rebased, 1)
    tr.mapping = mapping // FIXME remove when transactions have own mapping field
    state = tr.apply()
    ist(state.doc.text, "left base right")
    ist(undoDepth(state), 2)

    // Undo local unconfirmed change
    //
    // base --> left
    state = command(state, undo)
    ist(state.doc.text, "left base")

    // Redo local unconfirmed change
    //
    // base --> left --> right'
    state = command(state, redo)
    ist(state.doc.text, "left base right")
  })
})
