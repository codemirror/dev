import {tempEditor} from "./temp-editor"
import {EditorSelection} from "../../state/src"
import {EditorView, ViewPlugin, ViewUpdate} from "../src/"
import ist from "ist"

describe("EditorView extension", () => {
  it("calls update when the viewport changes", () => {
    class Viewports extends ViewPlugin {
      viewports: number[][]
      constructor(view: EditorView) {
        super()
        let {from, to} = view.viewport
        this.viewports = [[from, to]]
      }
      update({viewport: {from, to}}: ViewUpdate) {
        this.viewports.push([from, to])
      }
    }
    let cm = tempEditor("x\n".repeat(500), [Viewports.extension()])
    ist(cm.getPlugin(Viewports)!.viewports.length, 1)
    ist(cm.getPlugin(Viewports)!.viewports[0][0], 0)
    cm.dom.style.height = "300px"
    cm.dom.style.overflow = "auto"
    cm.dom.scrollTop = 300
    cm.docView.checkLayout()
    let val = cm.getPlugin(Viewports)!.viewports
    ist(val.length, 2)
    ist(val[1][0], 0, ">")
    ist(val[1][1], val[0][0], ">")
    cm.dom.scrollTop = 1000
    cm.docView.checkLayout()
    ist(cm.getPlugin(Viewports)!.viewports.length, 3)
  })

  it("calls update on plugins", () => {
    let updates = 0
    let cm = tempEditor("xyz", [class extends ViewPlugin {
      update(update: ViewUpdate) {
        ist(update.prevState.doc, prevDoc)
        ist(update.state.doc, cm.state.doc)
        prevDoc = cm.state.doc
        updates++
      }
    }.extension()])
    let prevDoc = cm.state.doc
    ist(updates, 0)
    cm.dispatch(cm.state.t().replace(1, 2, "u"))
    ist(updates, 1)
    cm.dispatch(cm.state.t().setSelection(EditorSelection.single(3)))
    ist(updates, 2)
  })

  it("allows content attributes to be changed through effects", () => {
    let cm = tempEditor("", [ViewPlugin.attributes(undefined, {spellcheck: "true"})])
    ist(cm.contentDOM.spellcheck, true)
  })

  it("allows editor attributes to be changed through effects", () => {
    let cm = tempEditor("", [ViewPlugin.attributes({class: "something"})])
    ist(cm.dom.classList.contains("something"))
    ist(cm.dom.classList.contains("codemirror"))
  })
})
