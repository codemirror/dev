import {tempEditor, requireFocus} from "./temp-editor"
import {EditorView} from "../src"
import ist from "ist"

function event(cm: EditorView, type: string) {
  cm.contentDOM.dispatchEvent(new CompositionEvent(type))
}

function up(node: Text, text: string, from = node.nodeValue!.length, to = from) {
  let val = node.nodeValue!
  node.nodeValue = val.slice(0, from) + text + val.slice(to)
  document.getSelection()!.collapse(node, from + text.length)
  return node
}

function compose(cm: EditorView, start: () => Text, f: ((node: Text) => void)[], end?: (node: Text) => void) {
  event(cm, "compositionstart")
  let node = start()
  let sel = document.getSelection()!
  for (let step of f) {
    step(node)
    let {focusNode, focusOffset} = sel
    cm.docView.observer.flush()
    ist(node.parentNode && cm.contentDOM.contains(node.parentNode))
    ist(sel.focusNode, focusNode)
    ist(sel.focusOffset, focusOffset)
    ist(cm.docView.composition)
    ist(hasCompositionNode(cm.docView))
  }
  event(cm, "compositionend")
  if (end) end(node)
  cm.docView.observer.flush()
  cm.docView.commitComposition()
  ist(!cm.docView.composition)
  ist(!hasCompositionNode(cm.docView))
}

function hasCompositionNode(view: any) {
  return view.constructor.name == "CompositionView" || view.children.some(hasCompositionNode)
}

describe("Composition", () => {
  it("supports composition on an empty line", () => {
    let cm = requireFocus(tempEditor("foo\n\nbar"))
    compose(cm, () => cm.domAtPos(4)!.node.appendChild(document.createTextNode("a")), [
      n => up(n, "b"),
      n => up(n, "c")
    ])
    ist(cm.state.doc.toString(), "foo\nabc\nbar")
  })

  it("supports composition at the end of a line", () => {
    let cm = requireFocus(tempEditor("foo"))
    compose(cm, () => cm.domAtPos(2)!.node as Text, [
      n => up(n, "!"),
      n => up(n, "?")
    ])
    ist(cm.state.doc.toString(), "foo!?")
  })

  it("supports composition inside existing text", () => {
    let cm = requireFocus(tempEditor("foo"))
    compose(cm, () => cm.domAtPos(2)!.node as Text, [
      n => up(n, "x", 1),
      n => up(n, "y", 2),
      n => up(n, "z", 3)
    ])
    ist(cm.state.doc.toString(), "fxyzoo")
  })

  it("can deal with Android-style newline-after-composition", () => {
    let cm = requireFocus(tempEditor("abcdef"))
    compose(cm, () => cm.domAtPos(2)!.node as Text, [
      n => up(n, "x", 3),
      n => up(n, "y", 4)
    ], n => {
      let line = n.parentNode.appendChild(document.createElement("div"))
      line.textContent = "def"
      n.nodeValue = "abcxy"
      document.getSelection()!.collapse(line, 0)
    })
    ist(cm.state.doc.toString(), "abcxy\ndef")
  })

  // FIXME test widgets next to compositions

  // FIXME test changes that override compositions

  // FIXME test decorations/highlighting around compositions
})
