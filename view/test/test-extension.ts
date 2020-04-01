import {tempEditor} from "./temp-editor"
import {EditorSelection, Text} from "@codemirror/next/state"
import {EditorView, ViewPlugin, ViewUpdate} from "@codemirror/next/view"
import ist from "ist"

describe("EditorView extension", () => {
  it("calls update when the viewport changes", () => {
    let viewports: {from: number, to: number}[] = []
    let plugin = ViewPlugin.define(view => {
      viewports.push(view.viewport)
      return {
        update(update: ViewUpdate) {
          if (update.viewportChanged) viewports.push(update.view.viewport)
        }
      }
    })
    let cm = tempEditor("x\n".repeat(500), [plugin])
    ist(viewports.length, 1)
    ist(viewports[0].from, 0)
    cm.dom.style.height = "300px"
    cm.scrollDOM.style.overflow = "auto"
    cm.scrollDOM.scrollTop = 2000
    cm.measure()
    ist(viewports.length, 2)
    ist(viewports[1].from, 0, ">")
    ist(viewports[1].to, viewports[0].from, ">")
    cm.scrollDOM.scrollTop = 4000
    cm.measure()
    ist(viewports.length, 3)
  })

  it("calls update on plugins", () => {
    let updates = 0, prevDoc: Text
    let plugin = ViewPlugin.define(view => {
      prevDoc = view.state.doc
      return {
        update(update: ViewUpdate) {
          ist(update.prevState.doc, prevDoc)
          ist(update.state.doc, cm.state.doc)
          prevDoc = cm.state.doc
          updates++
        }
      }
    })
    let cm = tempEditor("xyz", [plugin])
    ist(updates, 0)
    cm.dispatch(cm.state.t().replace(1, 2, "u"))
    ist(updates, 1)
    cm.dispatch(cm.state.t().setSelection(EditorSelection.single(3)))
    ist(updates, 2)
  })

  it("allows content attributes to be changed through effects", () => {
    let cm = tempEditor("", [EditorView.contentAttributes.of({spellcheck: "true"})])
    ist(cm.contentDOM.spellcheck, true)
  })

  it("allows editor attributes to be changed through effects", () => {
    let cm = tempEditor("", [EditorView.editorAttributes.of({class: "something"})])
    ist(cm.dom.classList.contains("something"))
    ist(cm.dom.classList.contains("cm-wrap"))
  })
})
