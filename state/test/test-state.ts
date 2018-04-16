const ist = require("ist")
import {EditorState, Change, Selection, Range} from "../src/state"
import {Text} from "../../doc/src/text"

describe("EditorState", () => {
  it("holds doc and selection properties", () => {
    let state = new EditorState(Text.create("hello"))
    ist(state.doc.text, "hello")
    ist(state.selection.primary.from, 0)
  })

  it("can apply changes", () => {
    let state = new EditorState(Text.create("hello"))
    let transaction = state.transaction.change(new Change(2, 4, "w")).change(new Change(4, 4, "!"))
    ist(transaction.doc.text, "hewo!")
    ist(transaction.apply().doc.text, "hewo!")
  })

  it("maps selection through changes", () => {
    let state = new EditorState(Text.create("abcdefgh"), new Selection([
      new Range(0),
      new Range(4),
      new Range(8)
    ]))
    let newState = state.transaction.replaceSelection("Q").apply()
    ist(newState.doc.text, "QabcdQefghQ")
    ist(newState.selection.ranges.map(r => r.from).join("/"), "1/6/11")
  })
})
