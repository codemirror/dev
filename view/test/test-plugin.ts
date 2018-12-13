import {tempEditor} from "./temp-editor"
import {EditorSelection, Behavior} from "../../state/src"
import {EditorView, ViewUpdate} from "../src/"
import ist from "ist"

describe("EditorView plugins", () => {
  it("calls update on transactions", () => {
    let called = 0
    let cm = tempEditor("one\ntwo", [Behavior.viewPlugin.use((view: EditorView) => {
      let doc = view.state.doc.toString()
      ist(doc, "one\ntwo")
      return {
        update(view: EditorView, update: ViewUpdate) {
          ist(update.oldState.doc.toString(), doc)
          doc = view.state.doc.toString()
          if (update.transactions.length == 1) called++
        }
      }
    })])
    cm.dispatch(cm.state.transaction.replace(0, 1, "O"))
    cm.dispatch(cm.state.transaction.replace(4, 5, "T"))
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1)))
    ist(called, 3)
  })

  it("calls update when the viewport changes", () => {
    let ports: number[][] = []
    let cm = tempEditor("x\n".repeat(500), [Behavior.viewPlugin.use(() => {
      return {
        update(view: EditorView) {
          ports.push([view.viewport.from, view.viewport.to])
        }
      }
    })])
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
    let cm = tempEditor("xyz", [Behavior.viewPlugin.use(() => {
      return {
        updateDOM() { updates++ }
      }
    })])
    ist(updates, 1)
    cm.dispatch(cm.state.transaction.replace(1, 2, "u"))
    ist(updates, 2)
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(3)))
    ist(updates, 2)
  })
})
