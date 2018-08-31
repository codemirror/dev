import {EditorView, Decoration, DecorationSet, WidgetType, DecoratedRange} from "../src/"
import {tempEditor, requireFocus} from "./temp-editor"
import {StateField, MetaSlot, Plugin, EditorSelection} from "../../state/src"
import ist from "ist"

const filterSlot = new MetaSlot<(from: number, to: number, spec: any) => boolean>("filterDeco")
const addSlot = new MetaSlot<DecoratedRange[]>("addDeco")

function decos(startState: DecorationSet = Decoration.none) {
  let field = new StateField<DecorationSet>({
    init() { return startState },
    apply(tr, value) {
      if (tr.docChanged) value = value.map(tr.changes)
      let add = tr.getMeta(addSlot), filter = tr.getMeta(filterSlot)
      if (add || filter) value = value.update(add, filter)
      return value
    }
  })
  return new Plugin({
    state: field,
    view(editorView: EditorView) {
      return {
        get decorations() { return editorView.state.getField(field) }
      }
    }
  })
}

function d(from: number, to: any, spec: any = null) {
  if (typeof to != "number") { spec = to; to = from }
  if (typeof spec == "string") spec = {attributes: {[spec]: "y"}}
  return from == to ? Decoration.point(from, spec) : Decoration.range(from, to, spec)
}

function decoEditor(doc: string, decorations: any = []) {
  return tempEditor(doc, [decos(Decoration.set(decorations))])
}

describe("EditorView decoration", () => {
  it("renders tag names", () => {
    let cm = decoEditor("one\ntwo", d(2, 5, {tagName: "em"}))
    ist(cm.contentDOM.innerHTML, "<div>on<em>e</em></div><div><em>t</em>wo</div>")
  })

  it("renders attributes", () => {
    let cm = decoEditor("foo bar", [d(0, 3, {attributes: {title: "t"}}),
                                    d(4, 7, {attributes: {lang: "nl"}})])
    ist(cm.contentDOM.querySelectorAll("[title]").length, 1)
    ist((cm.contentDOM.querySelector("[title]") as any).title, "t")
    ist(cm.contentDOM.querySelectorAll("[lang]").length, 1)
  })

  it("updates for added decorations", () => {
    let cm = decoEditor("hello\ngoodbye")
    cm.dispatch(cm.state.transaction.setMeta(addSlot, [d(2, 8, {class: "c"})]))
    let spans = cm.contentDOM.querySelectorAll(".c")
    ist(spans.length, 2)
    ist(spans[0].textContent, "llo")
    ist(spans[0].previousSibling!.textContent, "he")
    ist(spans[1].textContent, "go")
    ist(spans[1].nextSibling!.textContent, "odbye")
  })

  it("updates for removed decorations", () => {
    let cm = decoEditor("one\ntwo\nthree", [d(1, 12, {class: "x"}),
                                            d(4, 7, {tagName: "strong"})])
    cm.dispatch(cm.state.transaction.setMeta(filterSlot, (from: number) => from == 4))
    ist(cm.contentDOM.querySelectorAll(".x").length, 0)
    ist(cm.contentDOM.querySelectorAll("strong").length, 1)
  })

  it("doesn't update DOM that doesn't need to change", () => {
    let cm = decoEditor("one\ntwo", [d(0, 3, {tagName: "em"})])
    let secondLine = cm.contentDOM.lastChild!, secondLineText = secondLine.firstChild
    cm.dispatch(cm.state.transaction.setMeta(filterSlot, () => false))
    ist(cm.contentDOM.lastChild, secondLine)
    ist(secondLine.firstChild, secondLineText)
  })

  it("combines decoration classes", () => {
    let cm = decoEditor("abcdef", [d(0, 4, {class: "a"}), d(2, 6, {class: "b"})])
    ist(cm.contentDOM.querySelectorAll(".a").length, 2)
    ist(cm.contentDOM.querySelectorAll(".b").length, 2)
    ist(cm.contentDOM.querySelectorAll(".a.b").length, 1)
  })

  it("combines decoration styles", () => {
    let cm = decoEditor("abc", [d(1, 2, {attributes: {style: "color: red"}}),
                                d(1, 2, {attributes: {style: "text-decoration: underline"}})])
    let span = cm.contentDOM.querySelector("span")!
    ist(span.style.color, "red")
    ist(span.style.textDecoration, "underline")
  })

  it("drops entirely deleted decorations", () => {
    let cm = decoEditor("abc", [d(1, 2, {inclusiveStart: true, inclusiveEnd: true, tagName: "strong"})])
    cm.dispatch(cm.state.transaction.replace(0, 3, "a"))
    ist(cm.contentDOM.querySelector("strong"), null)
  })

  it("shrinks inclusive decorations when their sides are replaced", () => {
    let cm = decoEditor("abcde", [d(1, 4, {inclusiveStart: true, inclusiveEnd: true, tagName: "strong"})])
    cm.dispatch(cm.state.transaction.replace(3, 5, "a"))
    cm.dispatch(cm.state.transaction.replace(0, 2, "a"))
    ist(cm.contentDOM.querySelector("strong")!.textContent, "c")
  })

  class WordWidget extends WidgetType<string> {
    eq(otherSpec: string) { return this.spec.toLowerCase() == otherSpec.toLowerCase() }
    toDOM() {
      let dom = document.createElement("strong")
      dom.textContent = this.spec
      return dom
    }
  }

  describe("widget", () => {
    class OtherWidget extends WidgetType<string> {
      toDOM() { return document.createElement("img") }
    }

    it("draws widgets", () => {
      let cm = decoEditor("hello", [d(4, {widget: new WordWidget("hi")})])
      let w = cm.contentDOM.querySelector("strong")!
      ist(w)
      ist(w.textContent, "hi")
      ist(w.previousSibling!.textContent, "hell")
      ist(w.nextSibling!.textContent, "o")
      ist(w.contentEditable, "false")
    })

    it("supports editing around widgets", () => {
      let cm = decoEditor("hello", [d(4, {widget: new WordWidget("hi")})])
      cm.dispatch(cm.state.transaction.replace(3, 4, "").replace(3, 4, ""))
      ist(cm.contentDOM.querySelector("strong"))
    })

    it("compares widgets with their eq method", () => {
      let cm = decoEditor("hello", [d(4, {widget: new WordWidget("hi")})])
      let w = cm.contentDOM.querySelector("strong")
      cm.dispatch(cm.state.transaction
                  .setMeta(addSlot, [d(4, {widget: new WordWidget("HI")})])
                  .setMeta(filterSlot, () => false))
      ist(w, cm.contentDOM.querySelector("strong"))
    })

    it("doesn't consider different widgets types equivalent", () => {
      let cm = decoEditor("hello", [d(4, {widget: new WordWidget("hi")})])
      let w = cm.contentDOM.querySelector("strong")
      cm.dispatch(cm.state.transaction
                  .setMeta(addSlot, [d(4, {widget: new OtherWidget("hi")})])
                  .setMeta(filterSlot, () => false))
      ist(w, cm.contentDOM.querySelector("strong"), "!=")
    })

    it("orders widgets by side", () => {
      let cm = decoEditor("hello", [d(4, {widget: new WordWidget("C"), side: 10}),
                                    d(4, {widget: new WordWidget("B")}),
                                    d(4, {widget: new WordWidget("A"), side: -1})])
      let widgets = cm.contentDOM.querySelectorAll("strong")
      ist(widgets.length, 3)
      ist(widgets[0].textContent, "A")
      ist(widgets[1].textContent, "B")
      ist(widgets[2].textContent, "C")
    })

    it("places the cursor based on side", () => {
      requireFocus()
      let cm = decoEditor("abc", [d(2, {widget: new WordWidget("A"), side: -1}),
                                  d(2, {widget: new WordWidget("B"), side: 1})])
      cm.dispatch(cm.state.transaction.setSelection(EditorSelection.single(2)))
      cm.focus()
      let domSel = document.getSelection()
      ist(domSel.focusNode.childNodes[domSel.focusOffset - 1].textContent, "A")
      ist(domSel.focusNode.childNodes[domSel.focusOffset].textContent, "B")
    })
  })

  describe("collapsed", () => {
    it("omits collapsed content", () => {
      let cm = decoEditor("foobar", [d(1, 4, {collapsed: true})])
      ist(cm.contentDOM.textContent, "far")
    })

    it("can collapse across lines", () => {
      let cm = decoEditor("foo\nbar\nbaz\nbug", [d(1, 14, {collapsed: true})])
      ist(cm.contentDOM.childNodes.length, 1)
      ist(cm.contentDOM.firstChild!.textContent, "fg")
    })

    it("draws replacement widgets", () => {
      let cm = decoEditor("foo\nbar\nbaz", [d(6, 9, {collapsed: new WordWidget("X")})])
      ist(cm.contentDOM.textContent, "foobaXaz")
    })

    it("can handle multiple overlapping collapsed ranges", () => {
      let cm = decoEditor("foo\nbar\nbaz\nbug", [d(1, 6, {collapsed: true}), d(6, 9, {collapsed: true}), d(8, 14, {collapsed: true})])
      ist(cm.contentDOM.childNodes.length, 1)
      ist(cm.contentDOM.firstChild!.textContent, "fg")
    })
  })
})
