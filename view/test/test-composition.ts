import {tempEditor, requireFocus} from "./temp-editor"
import {EditorView, ViewField, Decoration, DecorationSet, WidgetType} from "../src"
import {EditorState} from "../../state/src"
import ist from "ist"

function event(cm: EditorView, type: string) {
  cm.contentDOM.dispatchEvent(new CompositionEvent(type))
}

function up(node: Text, text: string = "", from = node.nodeValue!.length, to = from) {
  let val = node.nodeValue!
  node.nodeValue = val.slice(0, from) + text + val.slice(to)
  document.getSelection()!.collapse(node, from + text.length)
  return node
}

function compose(cm: EditorView, start: () => Text,
                 update: ((node: Text) => void)[],
                 options: {end?: (node: Text) => void, cancel?: boolean} = {}) {
  event(cm, "compositionstart")
  let node!: Text, sel = document.getSelection()!
  for (let i = -1; i < update.length; i++) {
    if (i < 0) node = start()
    else update[i](node)
    let {focusNode, focusOffset} = sel
    cm.docView.observer.flush()

    if (options.cancel && i == update.length - 1) {
      ist(!cm.docView.composition)
      ist(!hasCompositionNode(cm.docView))
    } else {
      ist(node.parentNode && cm.contentDOM.contains(node.parentNode))
      ist(sel.focusNode, focusNode)
      ist(sel.focusOffset, focusOffset)
      ist(cm.docView.composition)
      ist(hasCompositionNode(cm.docView))
    }
  }
  event(cm, "compositionend")
  if (options.end) options.end(node)
  cm.docView.observer.flush()
  if (cm.docView.composing != 0) cm.docView.exitComposition() // FIXME too much internals!
  ist(!cm.docView.composition)
  ist(!hasCompositionNode(cm.docView))
}

function hasCompositionNode(view: any) {
  return view.constructor.name == "CompositionView" || view.children.some(hasCompositionNode)
}

function wordDeco(state: EditorState): DecorationSet {
  let re = /\w+/g, m, deco = [], text = state.doc.toString()
  while (m = re.exec(text))
    deco.push(Decoration.range(m.index, m.index + m[0].length, {class: "word"}))
  return Decoration.set(deco)
}

const wordHighlighter = ViewField.decorations({
  create({state}) { return wordDeco(state) },
  update(_, {state}) { return wordDeco(state) },
  map: false
})

function widgets(positions: number[], sides: number[]) {
  let xWidget = new class extends WidgetType<null> {
    toDOM() { let s = document.createElement("var"); s.textContent = "×"; return s }
  }(null)
  return ViewField.decorations({
    create() {
      return Decoration.set(positions.map((p, i) => Decoration.widget(p, {widget: xWidget, side: sides[i]})))
    },
    update(deco) { return deco }
  })
}

describe("Composition", () => {
  it("supports composition on an empty line", () => {
    let cm = requireFocus(tempEditor("foo\n\nbar"))
    compose(cm, () => up(cm.domAtPos(4)!.node.appendChild(document.createTextNode("a"))), [
      n => up(n, "b"),
      n => up(n, "c")
    ])
    ist(cm.state.doc.toString(), "foo\nabc\nbar")
  })

  it("supports composition at end of line in existing node", () => {
    let cm = requireFocus(tempEditor("foo"))
    compose(cm, () => up(cm.domAtPos(2)!.node as Text), [
      n => up(n, "!"),
      n => up(n, "?")
    ])
    ist(cm.state.doc.toString(), "foo!?")
  })

  it("supports composition at end of line in a new node", () => {
    let cm = requireFocus(tempEditor("foo"))
    compose(cm, () => up(cm.domAtPos(0)!.node.appendChild(document.createTextNode("!"))), [
      n => up(n, "?")
    ])
    ist(cm.state.doc.toString(), "foo!?")
  })

  it("supports composition at start of line in a new node", () => {
    let cm = requireFocus(tempEditor("foo"))
    compose(cm, () => {
      let l0 = cm.domAtPos(0)!.node
      return up(l0.insertBefore(document.createTextNode("!"), l0.firstChild))
    }, [
      n => up(n, "?")
    ])
    ist(cm.state.doc.toString(), "!?foo")
  })

  it("supports composition inside existing text", () => {
    let cm = requireFocus(tempEditor("foo"))
    compose(cm, () => up(cm.domAtPos(2)!.node as Text), [
      n => up(n, "x", 1),
      n => up(n, "y", 2),
      n => up(n, "z", 3)
    ])
    ist(cm.state.doc.toString(), "fxyzoo")
  })

  it("can deal with Android-style newline-after-composition", () => {
    let cm = requireFocus(tempEditor("abcdef"))
    compose(cm, () => up(cm.domAtPos(2)!.node as Text), [
      n => up(n, "x", 3),
      n => up(n, "y", 4)
    ], {end: n => {
      let line = n.parentNode!.appendChild(document.createElement("div"))
      line.textContent = "def"
      n.nodeValue = "abcxy"
      document.getSelection()!.collapse(line, 0)
    }})
    ist(cm.state.doc.toString(), "abcxy\ndef")
  })

  it("handles replacement of existing words", () => {
    let cm = requireFocus(tempEditor("one two three"))
    compose(cm, () => up(cm.domAtPos(1)!.node as Text, "five", 4, 7), [
      n => up(n, "seven", 4, 8),
      n => up(n, "zero", 4, 9)
    ])
    ist(cm.state.doc.toString(), "one zero three")
  })

  it("doesn't get interrupted by changes in decorations", () => {
    let cm = requireFocus(tempEditor("foo ...", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(5)!.node as Text), [
      n => up(n, "hi", 1, 4)
    ])
    ist(cm.state.doc.toString(), "foo hi")
  })

  it("works inside highlighted text", () => {
    let cm = requireFocus(tempEditor("one two", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(1)!.node as Text, "x"), [
      n => up(n, "y"),
      n => up(n, ".")
    ])
    ist(cm.state.doc.toString(), "onexy. two")
  })

  it("can handle compositions spanning multiple tokens", () => {
    let cm = requireFocus(tempEditor("one two", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(5)!.node as Text, "a"), [
      n => up(n, "b"),
      n => up(n, "c")
    ], {end: n => {
      ;(n.parentNode!.previousSibling! as ChildNode).remove()
      ;(n.parentNode!.previousSibling! as ChildNode).remove()
      return up(n, "xyzone ", 0)
    }})
    ist(cm.state.doc.toString(), "xyzone twoabc")
  })

  it("doesn't overwrite widgets next to the composition", () => {
    let cm = requireFocus(tempEditor("", [widgets([0, 0], [-1, 1])]))
    compose(cm, () => {
      let l0 = cm.domAtPos(0)!.node
      return up(l0.insertBefore(document.createTextNode("a"), l0.lastChild))
    }, [n => up(n, "b", 0, 1)], {end: () => {
      ist(cm.contentDOM.querySelectorAll("var").length, 2)
    }})
    ist(cm.state.doc.toString(), "b")
  })

  it("cancels composition when a change fully overlaps with it", () => {
    let cm = requireFocus(tempEditor("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5)!.node as Text, "x"), [
      () => cm.dispatch(cm.state.transaction.replace(2, 10, "---"))
    ], {cancel: true})
    ist(cm.state.doc.toString(), "on---hree")
  })

  it("cancels composition when a change partially overlaps with it", () => {
    let cm = requireFocus(tempEditor("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5)!.node as Text, "x", 0), [
      () => cm.dispatch(cm.state.transaction.replace(5, 12, "---"))
    ], {cancel: true})
    ist(cm.state.doc.toString(), "one\nx---ee")
  })

  it("cancels composition when a change happens inside of it", () => {
    let cm = requireFocus(tempEditor("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5)!.node as Text, "x", 0), [
      () => cm.dispatch(cm.state.transaction.replace(5, 6, "!"))
    ], {cancel: true})
    ist(cm.state.doc.toString(), "one\nx!wo\nthree")
  })

  it("doesn't cancel composition when a change happens elsewhere", () => {
    let cm = requireFocus(tempEditor("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5)!.node as Text, "x", 0), [
      n => up(n, "y", 1),
      () => cm.dispatch(cm.state.transaction.replace(1, 2, "!")),
      n => up(n, "z", 2)
    ])
    ist(cm.state.doc.toString(), "o!e\nxyztwo\nthree")
  })

  // FIXME also test with newline inserted directly in front of the composition
  it("doesn't cancel composition when the composition is moved into a new line", () => {
    let cm = requireFocus(tempEditor("one\ntwo three", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(9)!.node as Text, "x"), [
      n => up(n, "y"),
      () => cm.dispatch(cm.state.transaction.replace(4, 4, "\n")),
      n => up(n, "z")
    ])
    ist(cm.state.doc.toString(), "one\n\ntwo threexyz")
  })

  it("doesn't cancel composition when a newline is added immediately in front", () => {
    let cm = requireFocus(tempEditor("one\ntwo three", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(9)!.node as Text, "x"), [
      n => up(n, "y"),
      () => cm.dispatch(cm.state.transaction.replace(7, 8, "\n")),
      n => up(n, "z")
    ])
    ist(cm.state.doc.toString(), "one\ntwo\nthreexyz")
  })

  it("handles compositions rapidly following each other", () => {
    let cm = requireFocus(tempEditor("one\ntwo"))
    event(cm, "compositionstart")
    let one = cm.domAtPos(1)!.node as Text
    up(one, "!")
    cm.docView.observer.flush()
    event(cm, "compositionend")
    one.nodeValue = "one!!"
    let L2 = cm.contentDOM.lastChild
    event(cm, "compositionstart")
    let two = cm.domAtPos(7)!.node as Text
    ist(cm.contentDOM.lastChild, L2)
    up(two, ".")
    cm.docView.observer.flush()
    ist(hasCompositionNode(cm.docView))
    ist(getSelection().focusNode, two)
    ist(getSelection().focusOffset, 4)
    ist(cm.docView.composition)
    event(cm, "compositionend")
    cm.docView.observer.flush()
    ist(cm.state.doc.toString(), "one!!\ntwo.")
  })
})
