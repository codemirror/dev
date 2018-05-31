import {Decoration, DecorationSet} from "../src/"
import {tempEditor} from "./temp-editor"
import {StateField, MetaSlot, Plugin} from "../../state/src/state"
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
