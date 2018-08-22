import {tempEditor} from "./temp-editor"
import {EditorSelection} from "../../state/src"
import ist from "ist"

function domText(view) {
  let text = "", eol = false
  function scan(node) {
    if (node.nodeType == 1) {
      if (node.nodeName == "BR" || node.contentEditable == "false") return
      if (eol) { text += "\n"; eol = false }
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) scan(ch)
      eol = true
    } else if (node.nodeType == 3) {
      text += node.nodeValue
    }
  }
  scan(view.contentDOM)
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

  it("works in multiple lines", () => {
    let doc = "abcdefghijklmnopqrstuvwxyz\n".repeat(10)
    let cm = tempEditor("")
    cm.dispatch(cm.state.transaction.replace(0, 0, doc))
    ist(domText(cm), doc)
    cm.dispatch(cm.state.transaction.replace(0, 0, "/"))
    doc = "/" + doc
    ist(domText(cm), doc)
    cm.dispatch(cm.state.transaction.replace(100, 104, "$"))
    doc = doc.slice(0, 100) + "$" + doc.slice(104)
    ist(domText(cm), doc)
    cm.dispatch(cm.state.transaction.replace(500, 510, ""))
    doc = doc.slice(0, 500)
    ist(domText(cm), doc)
  })

  it("redraws lazily", () => {
    let cm = tempEditor("one\ntwo\nthree")
    let line0 = cm.domAtPos(0).node, line1 = line0.nextSibling, line2 = line1.nextSibling
    let text0 = line0.firstChild, text2 = line2.firstChild
    cm.dispatch(cm.state.transaction.replace(5, 5, "x"))
    ist(text0.parentElement, line0)
    ist(cm.contentDOM.contains(line0))
    ist(cm.contentDOM.contains(line1))
    ist(text2.parentElement, line2)
    ist(cm.contentDOM.contains(line2))
  })

  it("notices the doc needs to be redrawn when only inserting empty lines", () => {
    let cm = tempEditor("")
    cm.dispatch(cm.state.transaction.replace(0, 0, "\n\n\n"))
    ist(domText(cm), "\n\n\n")
  })

  it("draws BR nodes on empty lines", () => {
    let cm = tempEditor("one\n\ntwo")
    let emptyLine = cm.domAtPos(4).node
    ist(emptyLine.childNodes.length, 1)
    ist(emptyLine.firstChild.nodeName, "BR")
    cm.dispatch(cm.state.transaction.replace(4, 4, "x"))
    ist(!Array.from(cm.domAtPos(4).node.childNodes).some(n => (n as any).nodeName == "BR"))
  })

  it("only draws visible content", () => {
    let cm = tempEditor("a\n".repeat(500) + "b\n".repeat(500))
    cm.dom.style.height = "300px"
    cm.dom.style.overflow = "auto"
    cm.dom.scrollTop = 0
    cm.docView.checkLayout()
    ist(cm.contentDOM.childNodes.length, 500, "<")
    ist(cm.contentDOM.scrollHeight, 10000, ">")
    ist(!cm.contentDOM.textContent.match(/b/))
    cm.dom.scrollTop = cm.dom.scrollHeight / 2
    cm.docView.checkLayout()
    ist(cm.contentDOM.textContent.match(/b/))
  })

  it("keeps a drawn area around selection ends", () => {
    let cm = tempEditor("\nsecond\n" + "x\n".repeat(500) + "last")
    cm.dom.style.height = "300px"
    cm.dom.style.overflow = "auto"
    cm.dom.scrollTop = 3000
    cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(1, cm.state.doc.length)))
    cm.docView.checkLayout()
    cm.focus()
    let text = cm.contentDOM.textContent
    ist(text.length, 500, "<")
    ist(/second/.test(text))
    ist(/last/.test(text))
  })

  it("can handle replace-all like events", () => {
    let content = "", chars = "abcdefghijklmn    \n"
    for (let i = 0; i < 5000; i++) content += chars[Math.floor(Math.random() * chars.length)]
    let cm = tempEditor(content), tr = cm.state.transaction
    for (let pos = content.length;;) {
      let end = pos - Math.floor(Math.random() * 200)
      let start = end - Math.floor(Math.random() * 10)
      if (start < 0) break
      tr = tr.replace(start, end, "XYZ")
      content = content.slice(0, start) + "XYZ" + content.slice(end)
      pos = start
    }
    ist(tr.doc.toString(), content)
    cm.dispatch(tr)
    ist(domText(cm), content.slice(cm.viewport.from, cm.viewport.to))
  })
})
