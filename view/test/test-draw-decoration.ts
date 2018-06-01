import {Decoration, DecorationSet} from "../src/"
import {LineElementBuilder} from "../src/viewdesc"
import {tempEditor} from "./temp-editor"
import {StateField, MetaSlot, Plugin} from "../../state/src/state"
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

function d(from, to, spec) {
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
    cm.dispatch(cm.state.transaction.setMeta(addSlot, [d(2, 8, {attributes: {class: "c"}})]))
    let spans = cm.contentDOM.querySelectorAll(".c")
    ist(spans.length, 2)
    ist(spans[0].textContent, "llo")
    ist(spans[0].previousSibling.textContent, "he")
    ist(spans[1].textContent, "go")
    ist(spans[1].nextSibling.textContent, "odbye")
  })

  it("updates for removed decorations", () => {
    let cm = decoEditor("one\ntwo\nthree", [d(1, 12, {attributes: {class: "x"}}),
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
    ist(flatten(ranges), "xx=class,xx=class,xxxxxx=class")
    ist(ranges[0].map(r => (r as any).attrs.class).join(","), "a,a b,a")
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
