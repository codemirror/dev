import {tempEditor} from "./temp-editor"
import {EditorSelection, Plugin, EditorState, Transaction} from "../../state/src"
import {EditorView} from "../src/"
import ist from "ist"

describe("EditorView plugins", () => {
  it("calls updateState on transactions", () => {
    let called = 0
    let cm = tempEditor("one\ntwo", [new Plugin({view: (view: EditorView) => {
      let doc = view.state.doc.toString()
      ist(doc, "one\ntwo")
      return {
        updateState(view: EditorView, prev: EditorState, trs: Transaction[]) {
          ist(prev.doc.toString(), doc)
          doc = view.state.doc.toString()
          called++
          ist(trs.length, 1)
        }
      }
    }})])
    cm.dispatch(cm.state.transaction.replace(0, 1, "O"))
    cm.dispatch(cm.state.transaction.replace(4, 5, "T"))
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1)))
    ist(called, 3)
  })

  it("calls updateViewport when the viewport changes", () => {
    let ports: number[][] = []
    let cm = tempEditor("x\n".repeat(500), [new Plugin({view: () => {
      return {
        updateViewport(view: EditorView) {
          ports.push([view.viewport.from, view.viewport.to])
        }
      }
    }})])
    ist(ports.length, 1)
    ist(ports[0][0], 0)
    cm.dom.style.height = "300px"
    cm.dom.style.overflow = "auto"
    cm.dom.scrollTop = 300
    cm.docView.checkLayout()
    ist(ports.length, 2)
    ist(ports[1][0], 0, ">")
    ist(ports[1][1], ports[0][0], ">")
    cm.dom.scrollTop = 1000
    cm.docView.checkLayout()
    ist(ports.length, 3)
  })

  it("calls updateDOM when the DOM is changed", () => {
    let updates = 0
    let cm = tempEditor("xyz", [new Plugin({view: () => {
      return {
        updateDOM() { updates++ }
      }
    }})])
    ist(updates, 1)
    cm.dispatch(cm.state.transaction.replace(1, 2, "u"))
    ist(updates, 2)
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(3)))
    ist(updates, 2)
  })
})
