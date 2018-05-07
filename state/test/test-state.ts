const ist = require("ist")
import {EditorState, Change, Selection, Range} from "../src/state"

describe("EditorState", () => {
  it("holds doc and selection properties", () => {
    let state = EditorState.create({doc: "hello"})
    ist(state.doc.text, "hello")
    ist(state.selection.primary.from, 0)
  })

  it("can apply changes", () => {
    let state = EditorState.create({doc: "hello"})
    let transaction = state.transaction.change(new Change(2, 4, "w")).change(new Change(4, 4, "!"))
    ist(transaction.doc.text, "hewo!")
    ist(transaction.apply().doc.text, "hewo!")
  })

  it("maps selection through changes", () => {
    let state = EditorState.create({doc: "abcdefgh",
                                    selection: new Selection([new Range(0), new Range(4), new Range(8)])})
    let newState = state.transaction.replaceSelection("Q").apply()
    ist(newState.doc.text, "QabcdQefghQ")
    ist(newState.selection.ranges.map(r => r.from).join("/"), "1/6/11")
  })

  it("can store meta properties on transactions", () => {
    let tr = EditorState.create({doc: "foo"}).transaction.setMeta("something", 55)
    ist(tr.getMeta("something"), 55)
  })
})
