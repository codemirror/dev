import {Decoration, WidgetType, BlockType, BlockInfo, __test} from "@codemirror/next/view"
import {Text} from "@codemirror/next/text"
import {ChangedRange} from "@codemirror/next/state"
import ist from "ist"

const {HeightMap, HeightOracle, MeasuredHeights, QueryType} = __test

const byH = QueryType.ByHeight, byP = QueryType.ByPos

function o(doc: Text) {
  return (new HeightOracle).setDoc(doc)
}

describe("HeightMap", () => {
  it("starts empty", () => {
    let empty = HeightMap.empty()
    ist(empty.length, 0)
    ist(empty.size, 1)
  })

  function mk(text: Text, deco: any = []) {
    return HeightMap.empty().applyChanges([Decoration.set(deco)], Text.empty, o(text),
                                          [new ChangedRange(0, 0, 0, text.length)])
  }
  function doc(... lineLen: number[]) {
    let text = lineLen.map(len => "x".repeat(len))
    return Text.of(text)
  }

  it("grows to match the document", () => {
    ist(mk(doc(10, 10, 8)).length, 30)
  })

  class MyWidget extends WidgetType<number> {
    toDOM() { return document.body }
    get estimatedHeight() { return this.value }
  }
  class NoHeightWidget extends WidgetType<null> {
    toDOM() { return document.body }
  }

  it("separates lines with decorations on them", () => {
    let map = mk(doc(10, 10, 20, 5),
                 [Decoration.widget({widget: new MyWidget(20)}).range(5),
                  Decoration.replace({}).range(25, 46)])
    ist(map.length, 48)
    ist(map.toString(), "line(10:20) gap(10) line(26-21)")
  })

  it("ignores irrelevant decorations", () => {
    let map = mk(doc(10, 10, 20, 5),
                 [Decoration.widget({widget: new NoHeightWidget(null)}).range(5),
                  Decoration.mark({class: "ahah"}).range(25, 46)])
    ist(map.length, 48)
    ist(map.toString(), "gap(48)")
  })

  it("drops decorations from the tree when they are deleted", () => {
    let text = doc(20)
    let map = mk(text, [Decoration.widget({widget: new MyWidget(20)}).range(5)])
    ist(map.toString(), "line(20:20)")
    map = map.applyChanges([], text, o(text), [new ChangedRange(5, 5, 5, 5)])
    ist(map.toString(), "line(20)")
  })

  it("updates the length of replaced decorations for changes", () => {
    let text = doc(20)
    let map = mk(text, [Decoration.replace({}).range(5, 15)])
    map = map.applyChanges([Decoration.set(Decoration.replace({}).range(5, 10))], text, o(text.replace(7, 12, [""])),
                           [new ChangedRange(7, 12, 7, 7)])
    ist(map.toString(), "line(15-5)")
  })

  it("stores information about block widgets", () => {
    let text = doc(3, 3, 3), oracle = o(text)
    let map = mk(text, [Decoration.widget({widget: new MyWidget(10), side: -1, block: true}).range(0),
                        Decoration.widget({widget: new MyWidget(13), side: -1, block: true}).range(0),
                        Decoration.widget({widget: new MyWidget(5), side: 1, block: true}).range(3)])
    ist(map.toString(), "block(0)-block(0)-line(3)-block(0) gap(7)")
    ist(map.height, 28 + 3 * oracle.lineHeight)
    let {type} = map.lineAt(0, byP, text, 0, 0)
    ist((type as BlockInfo[]).map(b => b.height).join(), [10, 13, oracle.lineHeight, 5].join())
    ist(map.lineAt(4, byP, text, 0, 0).top, 28 + oracle.lineHeight)
    map = map.updateHeight(oracle, 0, false, new MeasuredHeights(0, [8, 12, 10, 20, 40, 20]))
    ist(map.toString(), "block(0)-block(0)-line(3)-block(0) line(3) line(3)")
    ist(map.height, 110)
  })

  it("stores information about block ranges", () => {
    let text = doc(3, 3, 3, 3, 3, 3)
    let map = mk(text, [Decoration.widget({widget: new MyWidget(10), side: -1, block: true}).range(4),
                        Decoration.replace({widget: new MyWidget(40), block: true}).range(4, 11),
                        Decoration.widget({widget: new MyWidget(15), side: 1, block: true}).range(11),
                        // This one covers the block widgets around it (due to being inclusive)
                        Decoration.replace({widget: new MyWidget(50), block: true, inclusive: true}).range(16, 19),
                        Decoration.widget({widget: new MyWidget(20), side: -1, block: true}).range(16),
                        Decoration.widget({widget: new MyWidget(10), side: 1, block: true}).range(19)])
    ist(map.toString(), "gap(3) block(0)-block(7)-block(0) gap(3) block(3) gap(3)")
    map = map.updateHeight(o(text), 0, false, new MeasuredHeights(4, [5, 5, 5, 10, 5]))
    ist(map.height, 2 * o(text).lineHeight + 30)
  })

  it("handles empty lines correctly", () => {
    let text = doc(0, 0, 0, 0, 0)
    let map = mk(text, [Decoration.widget({widget: new MyWidget(10), side: -1, block: true}).range(1),
                        Decoration.replace({widget: new MyWidget(20), block: true}).range(2, 2),
                        Decoration.widget({widget: new MyWidget(30), side: 1, block: true}).range(3)])
    ist(map.toString(), "gap(0) block(0)-line(0) block(0) line(0)-block(0) gap(0)")
    map = map.applyChanges([], text, o(text.replace(1, 3, ["y"])), [new ChangedRange(1, 3, 1, 2)])
    ist(map.toString(), "gap(3)")
  })

  it("joins ranges", () => {
    let text = doc(10, 10, 10, 10)
    let map = mk(text, [Decoration.replace({}).range(16, 27)])
    ist(map.toString(), "gap(10) line(21-11) gap(10)")
    map = map.applyChanges([], text, o(text.replace(5, 38, ["yyy"])), [new ChangedRange(5, 38, 5, 8)])
    ist(map.toString(), "gap(13)")
  })

  it("joins lines", () => {
    let text = doc(10, 10, 10)
    let map = mk(text, [Decoration.replace({}).range(2, 5),
                        Decoration.widget({widget: new MyWidget(20)}).range(24)])
    ist(map.toString(), "line(10-3) gap(10) line(10:20)")
    map = map.applyChanges([
      Decoration.set([Decoration.replace({}).range(2, 5),
                      Decoration.widget({widget: new MyWidget(20)}).range(12)])
    ], text, o(text.replace(10, 22, [""])), [new ChangedRange(10, 22, 10, 10)])
    ist(map.toString(), "line(20-3:20)")
  })

  it("materializes lines for measured heights", () => {
    let text = doc(10, 10, 10, 10), oracle = o(text)
    let map = mk(text, [])
      .updateHeight(oracle, 0, false, new MeasuredHeights(11, [28, 14, 5]))
    ist(map.toString(), "gap(10) line(10) line(10) line(10)")
    ist(map.height, 61)
  })

  it("can update lines across the tree", () => {
    let text = doc(...new Array(100).fill(10)), oracle = o(text)
    let map = mk(text).updateHeight(oracle, 0, false, new MeasuredHeights(0, new Array(100).fill(12)))
    ist(map.height, 1200)
    ist(map.size, 100)
    map = map.updateHeight(oracle, 0, false, new MeasuredHeights(55, new Array(90).fill(10)))
    ist(map.height, 1020)
    ist(map.size, 100)
  })

  function depth(heightMap: any): number {
    let {left, right} = heightMap
    return left ? Math.max(depth(left), depth(right)) + 1 : 1
  }

  it("balances a big tree", () => {
    let text = doc(...new Array(100).fill(30)), oracle = o(text)
    let map = mk(text).updateHeight(oracle, 0, false, new MeasuredHeights(0, new Array(100).fill(15)))
    ist(map.height, 1500)
    ist(map.size, 100)
    ist(depth(map), 9, "<")
    let text2 = text.replace(0, 31 * 80, [""])
    map = map.applyChanges([], text, o(text2), [new ChangedRange(0, 31 * 80, 0, 0)])
    ist(map.size, 20)
    ist(depth(map), 7, "<")
    let len = text2.length
    let text3 = text2.replace(len, len, "\nfoo".repeat(200).split("\n"))
    map = map.applyChanges([], text2, o(text3), [new ChangedRange(len, len, len, len + 800)])
    map = map.updateHeight(oracle.setDoc(text3), 0, false, new MeasuredHeights(len + 1, new Array(200).fill(10)))
    ist(map.size, 220)
    ist(depth(map), 12, "<")
  })

  it("can handle inserting a line break", () => {
    let text = doc(3, 3, 3), oracle = o(text)
    let map = mk(text).updateHeight(oracle, 0, false, new MeasuredHeights(0, [10, 10, 10]))
    ist(map.size, 3)
    let text2 = text.replace(3, 3, ["", ""])
    map = map.applyChanges([], text, oracle.setDoc(text2), [new ChangedRange(3, 3, 3, 4)])
      .updateHeight(oracle, 0, false, new MeasuredHeights(0, [10, 10, 10, 10]))
    ist(map.size, 4)
    ist(map.height, 40)
  })

  it("can handle insertion in the middle of a line", () => {
    let text = doc(3, 3, 3), oracle = o(text)
    let map = mk(text).updateHeight(oracle, 0, false, new MeasuredHeights(0, [10, 10, 10]))
    let text2 = text.replace(5, 5, ["foo", "bar", "baz", "bug"])
    map = map.applyChanges([], text, o(text2), [new ChangedRange(5, 5, 5, 20)])
      .updateHeight(o(text2), 0, false, new MeasuredHeights(0, [10, 10, 10, 10, 10, 10]))
    ist(map.size, 6)
    ist(map.height, 60)
  })

  describe("blockAt", () => {
    it("finds blocks in a gap", () => {
      let text = doc(3, 3, 3, 3, 3), map = mk(text)
      let block1 = map.blockAt(0, text, 0, 0)
      ist(block1.from, 0); ist(block1.to, 3)
      ist(block1.top, 0); ist(block1.bottom, 0, ">")
      ist(block1.type, BlockType.Text)
      let block2 = map.blockAt(block1.bottom + 1, text, 0, 0)
      ist(block2.from, 4); ist(block2.to, 7)
      ist(block2.top, block1.bottom); ist(block2.bottom, block1.bottom, ">")
      let block3 = map.blockAt(1e9, text, 0, 0)
      ist(block3.from, 16); ist(block3.to, 19)
      ist(block3.bottom, map.height)
    })

    it("finds blocks in lines", () => {
      let text = doc(3, 3, 3, 3), map = mk(text).updateHeight(o(text), 0, false, new MeasuredHeights(0, [10, 20, 10, 30]))
      let block1 = map.blockAt(-100, text, 0, 0)
      ist(block1.from, 0); ist(block1.to, 3)
      ist(block1.top, 0); ist(block1.bottom, 10)
      ist(block1.type, BlockType.Text)
      let block2 = map.blockAt(39, text, 0, 0)
      ist(block2.from, 8); ist(block2.to, 11)
      ist(block2.top, 30); ist(block2.bottom, 40)
      let block3 = map.blockAt(77, text, 0, 0)
      ist(block3.from, 12); ist(block3.to, 15)
      ist(block3.top, 40); ist(block3.bottom, 70)
    })

    it("finds widget blocks", () => {
      let text = doc(3, 3, 3, 3)
      let map = mk(text, [Decoration.widget({widget: new MyWidget(100), block: true, side: -1}).range(4),
                          Decoration.replace({widget: new MyWidget(30), block: true}).range(8, 11),
                          Decoration.widget({widget: new MyWidget(0), block: true, side: 1}).range(15)])
      let block1 = map.blockAt(0, text, 0, 0)
      ist(block1.from, 0); ist(block1.to, 3)
      let block2 = map.blockAt(block1.height + 1, text, 0, 0)
      ist(block2.from, 4); ist(block2.to, 4)
      ist(block2.top, block1.height); ist(block2.height, 100)
      ist(block2.type, BlockType.WidgetBefore)
      let top3 = block2.bottom + block1.height
      let block3 = map.blockAt(top3 + 10, text, 0, 0)
      ist(block3.from, 8); ist(block3.to, 11)
      ist(block3.top, top3); ist(block3.height, 30)
      ist(block3.type, BlockType.WidgetRange)
      let block4 = map.blockAt(block3.bottom + block1.height, text, 0, 0)
      ist(block4.type, BlockType.WidgetAfter, "!=")
    })
  })

  function eqBlock(a: BlockInfo, b: BlockInfo) {
    return a.from == b.from && a.to == b.to && a.top == b.top && a.bottom == b.bottom
  }

  describe("lineAt", () => {
    it("finds lines in gaps", () => {
      let text = doc(3, 3, 3, 3), map = mk(text)
      let line1 = map.lineAt(0, byP, text, 0, 0)
      ist(line1.from, 0); ist(line1.to, 3)
      ist(line1.top, 0)
      ist(map.lineAt(0, byH, text, 0, 0), line1, eqBlock)
      let line2 = map.lineAt(line1.to + 1, byP, text, 0, 0)
      ist(line2.from, 4); ist(line2.to, 7)
      ist(line2.top, line1.bottom)
      ist(map.lineAt(line1.bottom + 1, byH, text, 0, 0), line2, eqBlock)
      let line3 = map.lineAt(15, byP, text, 0, 0)
      ist(line3.from, 12); ist(line3.to, 15)
      ist(line3.bottom, map.height)
      ist(map.lineAt(1e9, byH, text, 0, 0), line3, eqBlock)
    })

    it("finds lines in lines", () => {
      let text = doc(3, 3, 3, 3), map = mk(text).updateHeight(o(text), 0, false, new MeasuredHeights(0, [10, 10, 20, 10]))
      let line1 = map.lineAt(0, byP, text, 0, 0)
      ist(line1.from, 0); ist(line1.to, 3)
      ist(line1.top, 0); ist(line1.bottom, 10)
      ist(map.lineAt(9, byH, text, 0, 0), line1, eqBlock)
      let line2 = map.lineAt(9, byP, text, 0, 0)
      ist(line2.from, 8); ist(line2.to, 11)
      ist(line2.top, 20); ist(line2.bottom, 40)
      ist(map.lineAt(39, byH, text, 0, 0), line2, eqBlock)
    })

    it("includes adjacent widgets in lines", () => {
      let text = doc(3, 3, 3, 3)
      let map = mk(text, [Decoration.widget({widget: new MyWidget(100), block: true, side: -1}).range(4),
                          Decoration.replace({widget: new MyWidget(30), block: true}).range(7, 8),
                          Decoration.widget({widget: new MyWidget(0), block: true, side: 1}).range(15)])
      let line1 = map.lineAt(4, byP, text, 0, 0)
      ist(line1.from, 4); ist(line1.to, 11)
      ist((line1.type as any[]).length, 4)
      ist(map.lineAt(line1.top + 1, byH, text, 0, 0), line1, eqBlock)
      ist(map.lineAt(line1.bottom - 1, byH, text, 0, 0), line1, eqBlock)
      ist(map.lineAt(line1.top + line1.height / 2, byH, text, 0, 0), line1, eqBlock)
      ist(map.lineAt(5, byP, text, 0, 0), line1, eqBlock)
      ist(map.lineAt(7, byP, text, 0, 0), line1, eqBlock)
      ist(map.lineAt(11, byP, text, 0, 0), line1, eqBlock)
      let line2 = map.lineAt(map.height, byH, text, 0, 0)
      ist(line2.from, 12); ist(line2.to, 15)
      ist((line2.type as any[]).length!, 2)
      ist(map.lineAt(line2.top + 1, byH, text, 0, 0), line2, eqBlock)
    })
  })
})
