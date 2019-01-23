import {tempEditor} from "./temp-editor"
import {EditorSelection} from "../../state/src"
import {viewPlugin, ViewField} from "../src/"
import ist from "ist"

describe("EditorView extension", () => {
  it("can maintain state", () => {
    let field = new ViewField<string[]>({
      create({state}) { return [state.doc.toString()] },
      update(value, update) {
        return update.transactions.length ? value.concat(update.state.doc.toString()) : value
      }
    })
    let cm = tempEditor("one\ntwo", [field.extension])
    cm.dispatch(cm.state.transaction.replace(0, 1, "O"))
    cm.dispatch(cm.state.transaction.replace(4, 5, "T"))
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1)))
    ist(cm.getField(field).join("/"), "one\ntwo/One\ntwo/One\nTwo/One\nTwo")
  })

  it("calls update when the viewport changes", () => {
    let ports = new ViewField<number[][]>({
      create({viewport: {from, to}}) { return [[from, to]] },
      update(ports, {viewport: {from, to}}) { return ports.concat([[from, to]]) }
    })
    let cm = tempEditor("x\n".repeat(500), [ports.extension])
    ist(cm.getField(ports).length, 1)
    ist(cm.getField(ports)[0][0], 0)
    cm.dom.style.height = "300px"
    cm.dom.style.overflow = "auto"
    cm.dom.scrollTop = 300
    cm.docView.checkLayout()
    let val = cm.getField(ports)
    ist(val.length, 2)
    ist(val[1][0], 0, ">")
    ist(val[1][1], val[0][0], ">")
    cm.dom.scrollTop = 1000
    cm.docView.checkLayout()
    ist(cm.getField(ports).length, 3)
  })

  it("calls update on plugins", () => {
    let updates = 0
    let cm = tempEditor("xyz", [viewPlugin(() => ({
      update(update) {
        ist(update.prevState.doc, prevDoc)
        ist(update.state.doc, cm.state.doc)
        prevDoc = cm.state.doc
        updates++
      }
    }))])
    let prevDoc = cm.state.doc
    ist(updates, 0)
    cm.dispatch(cm.state.transaction.replace(1, 2, "u"))
    ist(updates, 1)
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(3)))
    ist(updates, 2)
  })

  it("allows content attributes to be changed through effects", () => {
    let cm = tempEditor("", [ViewField.contentAttributes({spellcheck: "true"})])
    ist(cm.contentDOM.spellcheck, true)
  })

  it("allows editor attributes to be changed through effects", () => {
    let cm = tempEditor("", [ViewField.editorAttributes({class: "something"})])
    ist(cm.dom.classList.contains("something"))
    ist(cm.dom.classList.contains("codemirror"))
  })
})
