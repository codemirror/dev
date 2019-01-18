import {tempEditor} from "./temp-editor"
import {EditorSelection} from "../../state/src"
import {viewPlugin, ViewField} from "../src/"
import ist from "ist"

describe("EditorView extension", () => {
  it("can maintain state", () => {
    let field = new ViewField<string[]>({
      create({state}) { return [state.doc.toString()] },
      update(value, update) {
        return update.transactions.length ? value.concat(update.new.state.doc.toString()) : value
      }
    })
    let cm = tempEditor("one\ntwo", [field.extension])
    cm.dispatch(cm.state.transaction.replace(0, 1, "O"))
    cm.dispatch(cm.state.transaction.replace(4, 5, "T"))
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1)))
    ist(cm.fields.get(field).join("/"), "one\ntwo/One\ntwo/One\nTwo/One\nTwo")
  })

  it("calls update when the viewport changes", () => {
    let ports: number[][] = []
    let cm = tempEditor("x\n".repeat(500), [new ViewField<void>({
      create({viewport: {from, to}}) { ports.push([from, to]) },
      update(_, {new: {viewport: {from, to}}}) { ports.push([from, to]) }
    }).extension])
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
    let cm = tempEditor("xyz", [viewPlugin(() => ({
      update(update) {
        ist(update.old.state.doc, prevDoc)
        ist(update.new.state.doc, cm.state.doc)
        prevDoc = cm.state.doc
        updates++
      }
    }))])
    let prevDoc = cm.state.doc
    ist(updates, 0)
    cm.dispatch(cm.state.transaction.replace(1, 2, "u"))
    ist(updates, 1)
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(3)))
    ist(updates, 1)
  })
})
