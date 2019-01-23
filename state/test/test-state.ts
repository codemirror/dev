const ist = require("ist")
import {EditorState, Change, EditorSelection, SelectionRange, StateExtension, Transaction} from "../src"
import {Slot} from "../../extension/src/extension"

describe("EditorState", () => {
  it("holds doc and selection properties", () => {
    let state = EditorState.create({doc: "hello"})
    ist(state.doc.toString(), "hello")
    ist(state.selection.primary.from, 0)
  })

  it("can apply changes", () => {
    let state = EditorState.create({doc: "hello"})
    let transaction = state.transaction.change(new Change(2, 4, ["w"])).change(new Change(4, 4, ["!"]))
    ist(transaction.doc.toString(), "hewo!")
    ist(transaction.apply().doc.toString(), "hewo!")
  })

  it("maps selection through changes", () => {
    let state = EditorState.create({doc: "abcdefgh",
                                    extensions: [StateExtension.allowMultipleSelections(true)],
                                    selection: EditorSelection.create([0, 4, 8].map(n => new SelectionRange(n)))})
    let newState = state.transaction.replaceSelection("Q").apply()
    ist(newState.doc.toString(), "QabcdQefghQ")
    ist(newState.selection.ranges.map(r => r.from).join("/"), "1/6/11")
  })

  const someSlot = Slot.define<number>()

  it("can store slots on transactions", () => {
    let tr = EditorState.create({doc: "foo"}).transaction.addMeta(someSlot(55))
    ist(tr.getMeta(someSlot), 55)
  })

  it("throws when a change's bounds are invalid", () => {
    let state = EditorState.create({doc: "1234"})
    ist.throws(() => state.transaction.replace(-1, 1, ""))
    ist.throws(() => state.transaction.replace(2, 1, ""))
    ist.throws(() => state.transaction.replace(2, 10, "x"))
  })

  it("stores and updates tab size", () => {
    let deflt = EditorState.create({}), two = EditorState.create({tabSize: 2})
    ist(deflt.tabSize, 4)
    ist(two.tabSize, 2)
    let updated = deflt.transaction.addMeta(Transaction.changeTabSize(8)).apply()
    ist(updated.tabSize, 8)
  })

  it("stores and updates the line separator", () => {
    let deflt = EditorState.create({}), crlf = EditorState.create({lineSeparator: "\r\n"})
    ist(deflt.joinLines(["a", "b"]), "a\nb")
    ist(deflt.splitLines("foo\rbar").length, 2)
    ist(crlf.joinLines(["a", "b"]), "a\r\nb")
    ist(crlf.splitLines("foo\nbar\r\nbaz").length, 2)
    let updated = crlf.transaction.addMeta(Transaction.changeLineSeparator("\n")).apply()
    ist(updated.joinLines(["a", "b"]), "a\nb")
    ist(updated.splitLines("foo\nbar").length, 2)
  })
})
