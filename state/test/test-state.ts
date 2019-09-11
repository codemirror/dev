const ist = require("ist")
import {EditorState, StateField, Change, EditorSelection, SelectionRange, Transaction} from "../src"
import {Slot} from "../../extension/src/extension"

describe("EditorState", () => {
  it("holds doc and selection properties", () => {
    let state = EditorState.create({doc: "hello"})
    ist(state.doc.toString(), "hello")
    ist(state.selection.primary.from, 0)
  })

  it("can apply changes", () => {
    let state = EditorState.create({doc: "hello"})
    let transaction = state.t().change(new Change(2, 4, ["w"])).change(new Change(4, 4, ["!"]))
    ist(transaction.doc.toString(), "hewo!")
    ist(transaction.apply().doc.toString(), "hewo!")
  })

  it("maps selection through changes", () => {
    let state = EditorState.create({doc: "abcdefgh",
                                    extensions: [EditorState.allowMultipleSelections(true)],
                                    selection: EditorSelection.create([0, 4, 8].map(n => new SelectionRange(n)))})
    let newState = state.t().replaceSelection("Q").apply()
    ist(newState.doc.toString(), "QabcdQefghQ")
    ist(newState.selection.ranges.map(r => r.from).join("/"), "1/6/11")
  })

  const someSlot = Slot.define<number>()

  it("can store slots on transactions", () => {
    let tr = EditorState.create({doc: "foo"}).t().addMeta(someSlot(55))
    ist(tr.getMeta(someSlot), 55)
  })

  it("throws when a change's bounds are invalid", () => {
    let state = EditorState.create({doc: "1234"})
    ist.throws(() => state.t().replace(-1, 1, ""))
    ist.throws(() => state.t().replace(2, 1, ""))
    ist.throws(() => state.t().replace(2, 10, "x"))
  })

  it("stores and updates tab size", () => {
    let deflt = EditorState.create({}), two = EditorState.create({tabSize: 2})
    ist(deflt.tabSize, 4)
    ist(two.tabSize, 2)
    let updated = deflt.t().addMeta(Transaction.changeTabSize(8)).apply()
    ist(updated.tabSize, 8)
  })

  it("stores and updates the line separator", () => {
    let deflt = EditorState.create({}), crlf = EditorState.create({lineSeparator: "\r\n"})
    ist(deflt.joinLines(["a", "b"]), "a\nb")
    ist(deflt.splitLines("foo\rbar").length, 2)
    ist(crlf.joinLines(["a", "b"]), "a\r\nb")
    ist(crlf.splitLines("foo\nbar\r\nbaz").length, 2)
    let updated = crlf.t().addMeta(Transaction.changeLineSeparator("\n")).apply()
    ist(updated.joinLines(["a", "b"]), "a\nb")
    ist(updated.splitLines("foo\nbar").length, 2)
  })

  it("stores and updates fields", () => {
    let field1 = new StateField<number>({init: () => 0, apply: (tr, val) => val + 1})
    let field2 = new StateField<number>({init: state => state.getField(field1) + 10, apply: (tr, val) => val})
    let state = EditorState.create({extensions: [field1.extension, field2.extension]})
    ist(state.getField(field1), 0)
    ist(state.getField(field2), 10)
    let newState = state.t().apply()
    ist(newState.getField(field1), 1)
    ist(newState.getField(field2), 10)
  })

  it("can preserve fields across reconfiguration", () => {
    let field = new StateField({init: () => 0, apply: (tr, val) => val + 1, reconfigure: (state, val) => val + 100})
    let start = EditorState.create({extensions: [field.extension]}).t().apply()
    ist(start.getField(field), 1)
    ist(start.reconfigure([field.extension]).getField(field), 101)
    ist(start.reconfigure([]).getField(field, false), undefined)
  })
})
