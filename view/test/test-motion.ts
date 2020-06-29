import {tempEditor} from "./temp-editor"
import {StateField, EditorSelection} from "@codemirror/next/state"
import {EditorView, Decoration, DecorationSet, WidgetType} from "@codemirror/next/view"
import ist from "ist"

function cur(head: number) { return EditorSelection.cursor(head) }

class OWidget extends WidgetType<void> {
  toDOM() {
    let node = document.createElement("span")
    node.textContent = "ø"
    return node
  }
}

const widgetField = StateField.define<DecorationSet>({
  create(state) {
    let doc = state.doc.toString(), deco = []
    for (let i = 0; i < doc.length; i++) if (doc.charAt(i) == "o")
      deco.push(Decoration.replace({widget: new OWidget(undefined)}).range(i, i + 1))
    return Decoration.set(deco)
  },
  update(deco, tr) { return deco.map(tr.changes) },
  provide: [EditorView.decorations]
})
const oWidgets = [widgetField]

class BigWidget extends WidgetType<void> {
  toDOM() {
    let node = document.createElement("div")
    node.style.cssText = "background: yellow; height: 200px"
    return node
  }
  get estimatedHeight() { return 200 }
}

describe("EditorView.moveByChar", () => {
  it("does the right thing for character motion", () => {
    let cm = tempEditor([/*  0 */ "foo bar",
                         /*  8 */ "ao\u030c\u0318a\u030b\u0319x",
                         /* 17 */ "",
                         /* 18 */ "abcتممين"].join("\n"))
    for (let [from, to] of [[0, 1], [3, 4], [7, 8], [8, 9], [9, 12], [12, 15], [15, 16], [16, 17], [17, 18]])
      ist(cm.moveByChar(cur(from), true).head, to)
    for (let [from, to] of [[0, 0], [3, 2], [7, 6], [8, 7], [16, 15], [15, 12], [12, 9], [9, 8]])
      ist(cm.moveByChar(cur(from), false).head, to)
    let pos = cur(18), visitedLeft = [], visitedRight = [pos.head]
    for (let i = 0; i < 8; i++)
      visitedRight.push((pos = cm.moveByChar(pos, true)).head)
    visitedLeft.push(pos.head)
    for (let i = 0; i < 8; i++)
      visitedLeft.push((pos = cm.moveByChar(pos, false)).head)
    for (let i = 19; i < 26; i++) {
      ist(visitedLeft.indexOf(i), -1, ">")
      ist(visitedRight.indexOf(i), -1, ">")
    }
  })

  it("can move through widgets by character", () => {
    let cm = tempEditor("o, foo, do", [oWidgets]), len = cm.state.doc.length
    for (let i = 0; i <= len; i++)
      ist(cm.moveByChar(cur(i), true).head, Math.min(i + 1, len))
    for (let i = len; i >= 0; i--)
      ist(cm.moveByChar(cur(i), false).head, Math.max(0, i - 1))
  })
})

describe("EditorView.moveByGroup", () => {
  it("can move by group", () => {
    let cm = tempEditor("foo bar 国的狗 ...y\nx\n foo")
    for (let [from, to] of [[0, 3], [2, 3], [3, 7], [7, 11], [10, 11], [11, 15],
                            [15, 16], [16, 18], [18, 23], [23, 23]])
      ist(cm.moveByGroup(cur(from), true).head, to)
    for (let [from, to] of [[0, 0], [2, 0], [4, 0], [5, 4], [11, 8], [15, 12],
                            [17, 15], [20, 17], [23, 20]])
      ist(cm.moveByGroup(cur(from), false).head, to)
  })

  it("can move by word through bidi text", () => {
    let cm = tempEditor("foo خحج bar خحج خحج baz")
    let seenA: {[pos: number]: boolean} = {}, seenB: {[pos: number]: boolean} = {}
    for (let i = 0, pos = cur(0);; i++) {
      ist(!seenA[pos.head])
      seenA[pos.head] = true
      pos = cm.moveByGroup(pos, true)
      if (pos.head == 23) break
      ist(i < 10)
    }
    for (let i = 0, pos = cur(23);; i++) {
      ist(!seenB[pos.head])
      seenB[pos.head] = true
      pos = cm.moveByGroup(pos, false)
      if (pos.head == 0) break
      ist(i < 10)
    }
  })
})

describe("EditorView.moveVertically", () => {
  it("properly handles line motion", () => {
    let cm = tempEditor("one two\nthree\nتممين")
    ist(cm.moveVertically(cur(0), true).head, 8)
    ist(cm.moveVertically(cur(1), true).head, 9)
    ist(cm.moveVertically(cur(7), true).head, 13)
    let last = cm.moveVertically(cur(10), true).head
    ist(last, 19, "<")
    ist(last, 14, ">")
    cm.dispatch({selection: {anchor: 1}}) // Clear goal columns
    ist(cm.moveVertically(cur(last), false).head, 10)
    ist(cm.moveVertically(cur(12), false).head, 4)
    ist(cm.moveVertically(cur(13), false).head, 5)
    ist(cm.moveVertically(cur(8), false).head, 0)
  })

  it("can cross large line widgets", () => {
    const field = StateField.define<DecorationSet>({
      create() {
        return Decoration.set([
          Decoration.widget({widget: new BigWidget(undefined), side: 1, block: true}).range(3),
          Decoration.widget({widget: new BigWidget(undefined), side: -1, block: true}).range(4)
        ])
      },
      update(deco) { return deco },
      provide: [EditorView.decorations]
    })
    let cm = tempEditor("one\ntwo", [field])
    ist(cm.contentDOM.offsetHeight, 400, ">")
    ist(cm.moveVertically(cur(0), true).head, 4)
    ist(cm.moveVertically(cur(2), true).head, 6)
    ist(cm.moveVertically(cur(3), true).head, 7)
    ist(cm.moveVertically(cur(4), false).head, 0)
    ist(cm.moveVertically(cur(5), false).head, 1)
    ist(cm.moveVertically(cur(7), false).head, 3)
  })
})

describe("EditorView.moveToLineBoundary", () => {
  it("properly handles line-boundary motion", () => {
    let cm = tempEditor("\none two\n")
    ist(cm.moveToLineBoundary(cur(1), false).head, 1)
    ist(cm.moveToLineBoundary(cur(5), false).head, 1)
    ist(cm.moveToLineBoundary(cur(8), false).head, 1)
    ist(cm.moveToLineBoundary(cur(1), true).head, 8)
    ist(cm.moveToLineBoundary(cur(5), true).head, 8)
    ist(cm.moveToLineBoundary(cur(8), true).head, 8)
  })
})
