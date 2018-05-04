import {tempEditor} from "./temp-editor"
import ist from "ist"

function domText(view) {
  let text = ""
  for (let dom = view.contentDOM.firstChild; dom; dom = dom.nextSibling)
    text += dom.textContent + (dom.nextSibling ? "\n" : "")
  return text
}

describe("EditorView drawing", () => {
  it("follows updates to the document", () => {
    let cm = tempEditor("one\ntwo")
    ist(domText(cm), "one\ntwo")
    cm.dispatch(cm.state.transaction.replace(1, 2, "x"))
    ist(domText(cm), "oxe\ntwo")
    cm.dispatch(cm.state.transaction.replace(2, 5, "1\n2\n3"))
    ist(domText(cm), "ox1\n2\n3wo")
    cm.dispatch(cm.state.transaction.replace(1, 8, ""))
    ist(domText(cm), "oo")
  })

  it("works in big documents", () => {
    let doc = "abcdefghijklmnopqrstuvwxyz\n".repeat(300)
    let cm = tempEditor("")
    cm.dispatch(cm.state.transaction.replace(0, 0, doc))
    ist(domText(cm), doc)
    cm.dispatch(cm.state.transaction.replace(0, 0, "/"))
    doc = "/" + doc
    ist(domText(cm), doc)
    cm.dispatch(cm.state.transaction.replace(2000, 2004, "$"))
    doc = doc.slice(0, 2000) + "$" + doc.slice(2004)
    ist(domText(cm), doc)
    cm.dispatch(cm.state.transaction.replace(8000, 8100, ""))
    doc = doc.slice(0, 8000)
    ist(domText(cm), doc)
  })

  it("redraws lazily", () => {
    let cm = tempEditor("one\ntwo\nthree")
    let line0 = cm.contentDOM.firstChild, line1 = line0.nextSibling, line2 = line1.nextSibling
    let text0 = line0.firstChild, text2 = line2.firstChild
    cm.dispatch(cm.state.transaction.replace(5, 5, "x"))
    ist(text0.parentElement, line0)
    ist(line0.parentElement, cm.contentDOM)
    ist(line1.parentElement, cm.contentDOM)
    ist(text2.parentElement, line2)
    ist(line2.parentElement, cm.contentDOM)
  })
})
