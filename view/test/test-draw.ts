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
})
