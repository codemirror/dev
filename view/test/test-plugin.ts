import {tempEditor} from "./temp-editor"
import {EditorSelection} from "../../state/src"
import {EditorView, ViewUpdate, ViewExtension} from "../src/"
import ist from "ist"

describe("EditorView extension", () => {
  it("can maintain state", () => {
    let spec = {
      create(view: EditorView) { return [view.state.doc.toString()] },
      update(view: EditorView, update: ViewUpdate, value: string[]) {
        return update.transactions.length ? value.concat(view.state.doc.toString()) : value
      }
    }
    let cm = tempEditor("one\ntwo", [ViewExtension.state(spec)])
    cm.dispatch(cm.state.transaction.replace(0, 1, "O"))
    cm.dispatch(cm.state.transaction.replace(4, 5, "T"))
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1)))
    ist(cm.extensionState(spec)!.join("/"), "one\ntwo/One\ntwo/One\nTwo/One\nTwo")
  })

  it("calls update when the viewport changes", () => {
    let ports: number[][] = []
    let cm = tempEditor("x\n".repeat(500), [ViewExtension.state({
      create() {},
      update(view) { ports.push([view.viewport.from, view.viewport.to]) }
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

  it("calls update on DOM effects when the DOM is changed", () => {
    let updates = 0
    let cm = tempEditor("xyz", [ViewExtension.domEffect(() => ({
      update() { updates++ }
    }))])
    ist(updates, 0)
    cm.dispatch(cm.state.transaction.replace(1, 2, "u"))
    ist(updates, 1)
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(3)))
    ist(updates, 1)
  })
})
