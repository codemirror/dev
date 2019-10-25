import {tempEditor} from "./temp-editor"
import {EditorSelection} from "../../state"
import {EditorView, ViewPlugin, ViewUpdate} from ".."
import ist from "ist"

describe("EditorView extension", () => {
  it("calls update when the viewport changes", () => {
    let plugin = ViewPlugin.create(view => {
      let {from, to} = view.viewport
      return {
        viewports: [[from, to]],
        update({viewport: {from, to}}: ViewUpdate) {
          this.viewports.push([from, to])
        }
      }
    })
    let cm = tempEditor("x\n".repeat(500), [plugin.extension])
    ist(cm.plugin(plugin)!.viewports.length, 1)
    ist(cm.plugin(plugin)!.viewports[0][0], 0)
    cm.dom.style.height = "300px"
    cm.scrollDOM.style.overflow = "auto"
    cm.scrollDOM.scrollTop = 300
    cm.docView.checkLayout()
    let val = cm.plugin(plugin)!.viewports
    ist(val.length, 2)
    ist(val[1][0], 0, ">")
    ist(val[1][1], val[0][0], ">")
    cm.scrollDOM.scrollTop = 1000
    cm.docView.checkLayout()
    ist(cm.plugin(plugin)!.viewports.length, 3)
  })

  it("calls update on plugins", () => {
    let updates = 0
    let cm = tempEditor("xyz", [ViewPlugin.create(view => ({
      update(update: ViewUpdate) {
        ist(update.prevState.doc, prevDoc)
        ist(update.state.doc, cm.state.doc)
        prevDoc = cm.state.doc
        updates++
      }
    })).extension])
    let prevDoc = cm.state.doc
    ist(updates, 0)
    cm.dispatch(cm.state.t().replace(1, 2, "u"))
    ist(updates, 1)
    cm.dispatch(cm.state.t().setSelection(EditorSelection.single(3)))
    ist(updates, 2)
  })

  it("allows content attributes to be changed through effects", () => {
    let cm = tempEditor("", [EditorView.contentAttributes({spellcheck: "true"})])
    ist(cm.contentDOM.spellcheck, true)
  })

  it("allows editor attributes to be changed through effects", () => {
    let cm = tempEditor("", [EditorView.editorAttributes({class: "something"})])
    ist(cm.dom.classList.contains("something"))
    ist(cm.dom.classList.contains("codemirror"))
  })

  it("errors on duplicate plugins", () => {
    let plugin = ViewPlugin.create(() => ({}))
    ist.throws(() => new EditorView({extensions: [plugin.extension, plugin.extension]}),
               /Duplicated view plugin/)
  })
})
