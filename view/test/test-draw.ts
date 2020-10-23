import {tempEditor} from "./temp-editor"
import {EditorSelection} from "@codemirror/next/state"
import {EditorView} from "@codemirror/next/view"
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
    cm.dispatch({changes: {from: 1, to: 2, insert: "x"}})
    ist(domText(cm), "oxe\ntwo")
    cm.dispatch({changes: {from: 2, to: 5, insert: "1\n2\n3"}})
    ist(domText(cm), "ox1\n2\n3wo")
    cm.dispatch({changes: {from: 1, to: 8}})
    ist(domText(cm), "oo")
  })

  it("works in multiple lines", () => {
    let doc = "abcdefghijklmnopqrstuvwxyz\n".repeat(10)
    let cm = tempEditor("")
    cm.dispatch({changes: {from: 0, insert: doc}})
    ist(domText(cm), doc)
    cm.dispatch({changes: {from: 0, insert: "/"}})
    doc = "/" + doc
    ist(domText(cm), doc)
    cm.dispatch({changes: {from: 100, to: 104, insert: "$"}})
    doc = doc.slice(0, 100) + "$" + doc.slice(104)
    ist(domText(cm), doc)
    cm.dispatch({changes: {from: 200, to: 268}})
    doc = doc.slice(0, 200)
    ist(domText(cm), doc)
  })

  it("can split a line", () => {
    let cm = tempEditor("abc\ndef\nghi")
    cm.dispatch({changes: {from: 4, insert: "xyz\nk"}})
    ist(domText(cm), "abc\nxyz\nkdef\nghi")
  })

  it("redraws lazily", () => {
    let cm = tempEditor("one\ntwo\nthree")
    let line0 = cm.domAtPos(0).node, line1 = line0.nextSibling!, line2 = line1.nextSibling!
    let text0 = line0.firstChild!, text2 = line2.firstChild!
    cm.dispatch({changes: {from: 5, insert: "x"}})
    ist(text0.parentElement, line0)
    ist(cm.contentDOM.contains(line0))
    ist(cm.contentDOM.contains(line1))
    ist(text2.parentElement, line2)
    ist(cm.contentDOM.contains(line2))
  })

  it("notices the doc needs to be redrawn when only inserting empty lines", () => {
    let cm = tempEditor("")
    cm.dispatch({changes: {from: 0, insert: "\n\n\n"}})
    ist(domText(cm), "\n\n\n")
  })

  it("draws BR nodes on empty lines", () => {
    let cm = tempEditor("one\n\ntwo")
    let emptyLine = cm.domAtPos(4).node
    ist(emptyLine.childNodes.length, 1)
    ist(emptyLine.firstChild!.nodeName, "BR")
    cm.dispatch({changes: {from: 4, insert: "x"}})
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
    cm.dispatch({changes: {from: 2000, insert: "\n\n"}})
    ist(cm.contentDOM.lastChild, gap) // Make sure gap nodes are reused when resized
    cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight / 2
    cm.measure()
    ist(cm.contentDOM.textContent!.match(/b/))
  })

  it("keeps a drawn area around selection ends", () => {
    let cm = tempEditor("\nsecond\n" + "x\n".repeat(500) + "last", [], {scroll: 300})
    cm.dispatch({selection: EditorSelection.single(1, cm.state.doc.length)})
    cm.focus()
    let text = cm.contentDOM.textContent!
    ist(text.length, 500, "<")
    ist(/second/.test(text))
    ist(/last/.test(text))
  })

  it("can handle replace-all like events", () => {
    let content = "", chars = "abcdefghijklmn    \n"
    for (let i = 0; i < 5000; i++) content += chars[Math.floor(Math.random() * chars.length)]
    let cm = tempEditor(content), changes = []
    for (let i = Math.floor(content.length / 100); i >= 0; i--) {
      let from = Math.floor(Math.random() * (cm.state.doc.length - 10)), to = from + Math.floor(Math.random() * 10)
      changes.push({from, to, insert: "XYZ"})
    }
    cm.dispatch({changes})
    ist(domText(cm), cm.state.doc.slice(cm.viewport.from, cm.viewport.to))
  })

  it("can handle deleting a line's content", () => {
    let cm = tempEditor("foo\nbaz")
    cm.dispatch({changes: {from: 4, to: 7}})
    ist(domText(cm), "foo\n")
  })

  it("can insert blank lines at the end of the document", () => {
    let cm = tempEditor("foo")
    cm.dispatch({changes: {from: 3, insert: "\n\nx"}})
    ist(domText(cm), "foo\n\nx")
  })

  it("can handle deleting the end of a line", () => {
    let cm = tempEditor("a\nbc\n")
    cm.dispatch({changes: {from: 3, to: 4}})
    cm.dispatch({changes: {from: 3, insert: "d"}})
    ist(domText(cm), "a\nbd\n")
  })

  it("correctly handles very complicated transactions", () => {
    let doc = "foo\nbar\nbaz", chars = "abcdef  \n"
    let cm = tempEditor(doc)
    for (let i = 0; i < 10; i++) {
      let changes = [], pos = Math.min(20, doc.length)
      for (let j = 0; j < 1; j++) {
        let choice = Math.random(), r = Math.random()
        if (choice < 0.15) {
          pos = Math.min(doc.length, Math.max(0, pos + 5 - Math.floor(r * 10)))
        } else if (choice < 0.5) {
          let from = Math.max(0, pos - Math.floor(r * 2)), to = Math.min(doc.length, pos + Math.floor(r * 4))
          changes.push({from, to})
          pos = from
        } else {
          let text = ""
          for (let k = Math.floor(r * 6); k >= 0; k--) text += chars[Math.floor(chars.length * Math.random())]
          changes.push({from: pos, insert: text})
        }
      }
      cm.dispatch({changes})
      doc = cm.state.doc.toString()
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
    ;({node} = cm.domAtPos(cm.posAtCoords({x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2})!))
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
