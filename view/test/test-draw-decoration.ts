import {Decoration, DecorationSet, WidgetType} from "../src/"
import {LineElementBuilder} from "../src/viewdesc"
import {tempEditor} from "./temp-editor"
import {StateField, MetaSlot, Plugin, Selection} from "../../state/src/state"
import {Text} from "../../doc/src/text"
import ist from "ist"

const filterSlot = new MetaSlot<(from: number, to: number, spec: any) => boolean>("filterDeco")
const addSlot = new MetaSlot<Decoration[]>("addDeco")

function decos(startState: DecorationSet = DecorationSet.empty) {
  let field = new StateField<DecorationSet>({
    init() { return startState },
    apply(tr, value) {
      if (tr.changes.length) value = value.map(tr.changes)
      let add = tr.getMeta(addSlot), filter = tr.getMeta(filterSlot)
      if (add || filter) value = value.update(add, filter)
      return value
    }
  })
  return new Plugin({
    state: field,
    props: {
      decorations(state) { return state.getField(field) }
    }
  })
}

function d(from, to, spec = null) {
  if (typeof to != "number") { spec = to; to = from }
  if (typeof spec == "string") spec = {attributes: {[spec]: "y"}}
  return from == to ? Decoration.point(from, spec) : Decoration.range(from, to, spec)
}

function decoEditor(doc, decorations: any = []) {
  return tempEditor(doc, {plugins: [decos(DecorationSet.of(decorations))]})
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
    ist(cm.contentDOM.querySelector("[title]").title, "t")
    ist(cm.contentDOM.querySelectorAll("[lang]").length, 1)
  })

  it("updates for added decorations", () => {
    let cm = decoEditor("hello\ngoodbye")
    cm.dispatch(cm.state.transaction.setMeta(addSlot, [d(2, 8, {class: "c"})]))
    let spans = cm.contentDOM.querySelectorAll(".c")
    ist(spans.length, 2)
    ist(spans[0].textContent, "llo")
    ist(spans[0].previousSibling.textContent, "he")
    ist(spans[1].textContent, "go")
    ist(spans[1].nextSibling.textContent, "odbye")
  })

  it("updates for removed decorations", () => {
    let cm = decoEditor("one\ntwo\nthree", [d(1, 12, {class: "x"}),
                                            d(4, 7, {tagName: "strong"})])
    cm.dispatch(cm.state.transaction.setMeta(filterSlot, from => from == 4))
    ist(cm.contentDOM.querySelectorAll(".x").length, 0)
    ist(cm.contentDOM.querySelectorAll("strong").length, 1)
  })

  it("doesn't update DOM that doesn't need to change", () => {
    let cm = decoEditor("one\ntwo", [d(0, 3, {tagName: "em"})])
    let secondLine = cm.contentDOM.lastChild, secondLineText = secondLine.firstChild
    cm.dispatch(cm.state.transaction.setMeta(filterSlot, () => false))
    ist(cm.contentDOM.lastChild, secondLine)
    ist(secondLine.firstChild, secondLineText)
  })

  class WordWidget extends WidgetType<string> {
    eq(otherSpec) { return this.spec.toLowerCase() == otherSpec.toLowerCase() }
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
      let w = cm.contentDOM.querySelector("strong")
      ist(w)
      ist(w.textContent, "hi")
      ist(w.previousSibling.textContent, "hell")
      ist(w.nextSibling.textContent, "o")
      ist(w.contentEditable, "true")
    })

    it("supports editing around widgets", () => {
      let cm = decoEditor("hello", [d(4, {widget: new WordWidget("hi")})])
      cm.dispatch(cm.state.transaction.replace(3, 4, "").replace(3, 5, ""))
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
      if (!document.hasFocus()) return
      let cm = decoEditor("abc", [d(2, {widget: new WordWidget("A"), side: -1}),
                                  d(2, {widget: new WordWidget("B"), side: 1})])
      cm.dispatch(cm.state.transaction.setSelection(Selection.single(2)))
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
      ist(cm.contentDOM.firstChild.textContent, "fg")
    })

    it("draws replacement widgets", () => {
      let cm = decoEditor("foo\nbar\nbaz", [d(6, 9, {collapsed: new WordWidget("X")})])
      ist(cm.contentDOM.textContent, "foobaXaz")
    })

    it("can handle multiple overlapping collapsed ranges", () => {
      let cm = decoEditor("foo\nbar\nbaz\nbug", [d(1, 6, {collapsed: true}), d(6, 9, {collapsed: true}), d(8, 14, {collapsed: true})])
      ist(cm.contentDOM.childNodes.length, 1)
      ist(cm.contentDOM.firstChild.textContent, "fg")
    })
  })
})

describe("LineElementBuilder.build", () => {
  function flatten(ranges) {
    return ranges.map(range => range.map(id).join(",")).join("/")
  }
  function id(span) {
    return span.text + (span.attrs ? "=" + Object.keys(span.attrs).sort().join("&") : "")
  }

  it("separates the range in covering spans", () => {
    let set = DecorationSet.of([d(3, 8, "one"), d(5, 8, "two"), d(10, 12, "three")])
    let ranges = LineElementBuilder.build(Text.create("012345678901234"), 0, 15, [set])
    ist(flatten(ranges), "012,34=one,567=one&two,89,01=three,234")
  })

  it("can retrieve a limited range", () => {
    let decos = [d(0, 200, "wide")]
    for (let i = 0; i < 100; i++) decos.push(d(i * 2, i * 2 + 2, "span" + i))
    let set = DecorationSet.of(decos), start = set.children[0].length + set.children[1].length - 3, end = start + 6
    let expected = ""
    for (let pos = start; pos < end; pos += (pos % 2 ? 1 : 2))
      expected += (expected ? "," : "") + "x".repeat(Math.min(end, pos + (pos % 2 ? 1 : 2)) - pos) + "=span" + Math.floor(pos / 2) + "&wide"
    ist(flatten(LineElementBuilder.build(Text.create("x".repeat(end)), start, end, [set])), expected)
  })

  it("ignores decorations that don't affect spans", () => {
    let decos = [d(0, 10, "yes"), Decoration.range(5, 6, {})]
    ist(flatten(LineElementBuilder.build(Text.create("x".repeat(15)), 2, 15, [DecorationSet.of(decos)])), "xxxxxxxx=yes,xxxxx")
  })

  it("combines classes", () => {
    let decos = [Decoration.range(0, 10, {attributes: {class: "a"}}),
                 Decoration.range(2, 4, {attributes: {class: "b"}})]
    let ranges = LineElementBuilder.build(Text.create("x".repeat(10)), 0, 10, [DecorationSet.of(decos)])
    ist(flatten(ranges), "xx,xx,xxxxxx")
    ist(ranges[0].map(r => r.class).join(","), "a,a b,a")
  })

  it("combines styles", () => {
    let decos = [Decoration.range(0, 6, {attributes: {style: "color: red"}}),
                 Decoration.range(4, 10, {attributes: {style: "background: blue"}})]
    let ranges = LineElementBuilder.build(Text.create("x".repeat(10)), 0, 10, [DecorationSet.of(decos)])
    ist(flatten(ranges), "xxxx=style,xx=style,xxxx=style")
    ist(ranges[0].map(r => (r as any).attrs.style).join(","), "color: red,color: red;background: blue,background: blue")
  })

  it("reads from multiple sets at once", () => {
    let one = DecorationSet.of([d(2, 3, "x"), d(5, 10, "y"), d(10, 12, "z")])
    let two = DecorationSet.of([d(0, 6, "a"), d(10, 12, "b")])
    ist(flatten(LineElementBuilder.build(Text.create("x".repeat(12)), 0, 12, [one, two])),
        "xx=a,x=a&x,xx=a,x=a&y,xxxx=y,xx=b&z")
  })

  it("splits on line boundaries", () => {
    let ranges = LineElementBuilder.build(Text.create("\none\n\ntwo"), 0, 9,
                                          [DecorationSet.of([d(0, 3, "x"), d(2, 8, "y")])])
    ist(flatten(ranges), "/o=x,n=x&y,e=y//tw=y,o")
  })
})
