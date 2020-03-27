import {tempEditor} from "./temp-editor"
import {EditorSelection} from "../../state"
import {EditorView} from ".."
import ist from "ist"

function domText(view: EditorView) {
  let text = "", eol = false
  function scan(node: Node) {
    if (node.nodeType == 1) {
      if (node.nodeName == "BR" || (node as HTMLElement).contentEditable == "false") return
      if (eol) { text += "\n"; eol = false }
      for (let ch = node.firstChild as (Node | null); ch; ch = ch.nextSibling) scan(ch)
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
    cm.dispatch(cm.state.t().replace(1, 2, "x"))
    ist(domText(cm), "oxe\ntwo")
    cm.dispatch(cm.state.t().replace(2, 5, ["1", "2", "3"]))
    ist(domText(cm), "ox1\n2\n3wo")
    cm.dispatch(cm.state.t().replace(1, 8, ""))
    ist(domText(cm), "oo")
  })

  it("works in multiple lines", () => {
    let doc = "abcdefghijklmnopqrstuvwxyz\n".repeat(10)
    let cm = tempEditor("")
    cm.dispatch(cm.state.t().replace(0, 0, doc))
    ist(domText(cm), doc)
    cm.dispatch(cm.state.t().replace(0, 0, "/"))
    doc = "/" + doc
    ist(domText(cm), doc)
    cm.dispatch(cm.state.t().replace(100, 104, "$"))
    doc = doc.slice(0, 100) + "$" + doc.slice(104)
    ist(domText(cm), doc)
    cm.dispatch(cm.state.t().replace(200, 268, ""))
    doc = doc.slice(0, 200)
    ist(domText(cm), doc)
  })

  it("can split a line", () => {
    let cm = tempEditor("abc\ndef\nghi")
    cm.dispatch(cm.state.t().replace(4, 4, "xyz\nk"))
    ist(domText(cm), "abc\nxyz\nkdef\nghi")
  })

  it("redraws lazily", () => {
    let cm = tempEditor("one\ntwo\nthree")
    let line0 = cm.domAtPos(0).node, line1 = line0.nextSibling!, line2 = line1.nextSibling!
    let text0 = line0.firstChild!, text2 = line2.firstChild!
    cm.dispatch(cm.state.t().replace(5, 5, "x"))
    ist(text0.parentElement, line0)
    ist(cm.contentDOM.contains(line0))
    ist(cm.contentDOM.contains(line1))
    ist(text2.parentElement, line2)
    ist(cm.contentDOM.contains(line2))
  })

  it("notices the doc needs to be redrawn when only inserting empty lines", () => {
    let cm = tempEditor("")
    cm.dispatch(cm.state.t().replace(0, 0, "\n\n\n"))
    ist(domText(cm), "\n\n\n")
  })

  it("draws BR nodes on empty lines", () => {
    let cm = tempEditor("one\n\ntwo")
    let emptyLine = cm.domAtPos(4).node
    ist(emptyLine.childNodes.length, 1)
    ist(emptyLine.firstChild!.nodeName, "BR")
    cm.dispatch(cm.state.t().replace(4, 4, "x"))
    ist(!Array.from(cm.domAtPos(4).node.childNodes).some(n => (n as any).nodeName == "BR"))
  })

  it("only draws visible content", () => {
    let cm = tempEditor("a\n".repeat(500) + "b\n".repeat(500), [], {scroll: 300})
    cm.scrollDOM.scrollTop = 3000
    cm.measure()
    ist(cm.contentDOM.childNodes.length, 500, "<")
    ist(cm.contentDOM.scrollHeight, 10000, ">")
    ist(!cm.contentDOM.textContent!.match(/b/))
    let gap = cm.contentDOM.lastChild
    cm.dispatch(cm.state.t().replace(2000, 2000, "\n\n"))
    ist(cm.contentDOM.lastChild, gap) // Make sure gap nodes are reused when resized
    cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight / 2
    cm.measure()
    ist(cm.contentDOM.textContent!.match(/b/))
  })

  it("keeps a drawn area around selection ends", () => {
    let cm = tempEditor("\nsecond\n" + "x\n".repeat(500) + "last", [], {scroll: 300})
    cm.dispatch(cm.state.t().setSelection(EditorSelection.single(1, cm.state.doc.length)))
    cm.focus()
    let text = cm.contentDOM.textContent!
    ist(text.length, 500, "<")
    ist(/second/.test(text))
    ist(/last/.test(text))
  })

  it("can handle replace-all like events", () => {
    let content = "", chars = "abcdefghijklmn    \n"
    for (let i = 0; i < 5000; i++) content += chars[Math.floor(Math.random() * chars.length)]
    let cm = tempEditor(content), tr = cm.state.t()
    for (let i = Math.floor(content.length / 100); i >= 0; i--) {
      let from = Math.floor(Math.random() * (tr.doc.length - 10)), to = from + Math.floor(Math.random() * 10)
      tr.replace(from, to, "XYZ")
      content = content.slice(0, from) + "XYZ" + content.slice(to)
    }
    ist(tr.doc.toString(), content)
    cm.dispatch(tr)
    ist(domText(cm), content.slice(cm.viewport.from, cm.viewport.to))
  })

  it("can handle deleting a line's content", () => {
    let cm = tempEditor("foo\nbaz")
    cm.dispatch(cm.state.t().replace(4, 7, ""))
    ist(domText(cm), "foo\n")
  })

  it("can insert blank lines at the end of the document", () => {
    let cm = tempEditor("foo")
    cm.dispatch(cm.state.t().replace(3, 3, "\n\nx"))
    ist(domText(cm), "foo\n\nx")
  })

  it("can handle deleting the end of a line", () => {
    let cm = tempEditor("a\nbc\n")
    cm.dispatch(cm.state.t().replace(3, 4, ""))
    cm.dispatch(cm.state.t().replace(3, 3, "d"))
    ist(domText(cm), "a\nbd\n")
  })

  it("correctly handles very complicated transactions", () => {
    let doc = "foo\nbar\nbaz", chars = "abcdef  \n"
    let cm = tempEditor(doc)
    for (let i = 0; i < 10; i++) {
      let tr = cm.state.t(), pos = Math.min(20, doc.length)
      for (let j = 0; j < 1; j++) {
        let choice = Math.random(), r = Math.random()
        if (choice < 0.15) {
          pos = Math.min(doc.length, Math.max(0, pos + 5 - Math.floor(r * 10)))
        } else if (choice < 0.5) {
          let from = Math.max(0, pos - Math.floor(r * 2)), to = Math.min(doc.length, pos + Math.floor(r * 4))
          tr.replace(from, to, "")
          doc = doc.slice(0, from) + doc.slice(to)
          pos = from
        } else {
          let text = ""
          for (let k = Math.floor(r * 6); k >= 0; k--) text += chars[Math.floor(chars.length * Math.random())]
          tr.replace(pos, pos, text)
          doc = doc.slice(0, pos) + text + doc.slice(pos)
          pos += text.length
        }
      }
      cm.dispatch(tr)
      ist(domText(cm), doc.slice(cm.viewport.from, cm.viewport.to))
    }
  })

  function later() {
    return new Promise(resolve => setTimeout(resolve, 50))
  }

  it("notices it is added to the DOM even if initially detached", () => {
    if (!(window as any).IntersectionObserver) return // Only works with intersection observer support
    let cm = tempEditor("a\n\b\nc\nd", [EditorView.contentAttributes.of({style: "font-size: 60px"})])
    let parent = cm.dom.parentNode!
    cm.dom.remove()
    return later().then(() => {
      parent.appendChild(cm.dom)
      return later().then(() => {
        ist(cm.contentHeight, 200, ">")
      })
    })
  })

  it("hides parts of long lines that are horizontally out of view", () => {
    let cm = tempEditor("one\ntwo\n?" + "three ".repeat(3333) + "!\nfour")
    let {node} = cm.domAtPos(9)
    ist(node.nodeValue!.length, 2e4, "<")
    ist(node.nodeValue!.indexOf("!"), -1)
    ist(cm.scrollDOM.scrollWidth, cm.defaultCharacterWidth * 1.6e4, ">")
    cm.scrollDOM.scrollLeft = cm.scrollDOM.scrollWidth
    cm.measure()
    ;({node} = cm.domAtPos(20007)!)
    ist(node.nodeValue!.length, 2e4, "<")
    ist(node.nodeValue!.indexOf("!"), -1, ">")
    ist(cm.scrollDOM.scrollWidth, cm.defaultCharacterWidth * 1.6e4, ">")
  })

  it("hides parts of long lines that are vertically out of view", () => {
    let cm = tempEditor("<" + "long line ".repeat(4e3) + ">", [], {scroll: 100, wrapping: true})
    let {node} = cm.domAtPos(1)
    ist(node.nodeValue!.length, cm.state.doc.length, "<")
    ist(node.nodeValue!.indexOf("<"), -1, ">")
    cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight / 2
    cm.measure()
    let rect = cm.scrollDOM.getBoundingClientRect()
    ;({node} = cm.domAtPos(cm.posAtCoords({x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2})))
    ist(node.nodeValue!.length, cm.state.doc.length, "<")
    ist(node.nodeValue!.indexOf("<"), -1)
    ist(node.nodeValue!.indexOf(">"), -1)
    cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight
    cm.measure()
    ;({node} = cm.domAtPos(cm.state.doc.length - 1))
    ist(node.nodeValue!.length, cm.state.doc.length, "<")
    ist(node.nodeValue!.indexOf(">"), -1, ">")
  })

  it("properly attaches styles in shadow roots", () => {
    let ws = document.querySelector("#workspace")!
    let wrap = ws.appendChild(document.createElement("div"))
    if (!wrap.attachShadow) return
    let shadow = wrap.attachShadow({mode: "open"})
    let editor = new EditorView({root: shadow})
    shadow.appendChild(editor.dom)
    editor.measure()
    ist(getComputedStyle(editor.dom).display, "flex")
    wrap.remove()
  })
})
