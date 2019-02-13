import {HeightMap, HeightOracle, MeasuredHeights} from "../src/heightmap"
import {Decoration, WidgetType} from "../src/decoration"
import {Text} from "../../doc/src"
import {ChangedRange} from "../../state/src"
const ist = require("ist")

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
                 [Decoration.widget(5, {widget: new MyWidget(20)}),
                  Decoration.replace(25, 46, {})])
    ist(map.length, 48)
    ist(map.toString(), "line(10:20) gap(10) line(26-21)")
  })

  it("ignores irrelevant decorations", () => {
    let map = mk(doc(10, 10, 20, 5),
                 [Decoration.widget(5, {widget: new NoHeightWidget(null)}),
                  Decoration.mark(25, 46, {class: "ahah"})])
    ist(map.length, 48)
    ist(map.toString(), "gap(48)")
  })

  it("drops decorations from the tree when they are deleted", () => {
    let text = doc(20)
    let map = mk(text, [Decoration.widget(5, {widget: new MyWidget(20)})])
    ist(map.toString(), "line(20:20)")
    map = map.applyChanges([], text, o(text), [new ChangedRange(5, 5, 5, 5)])
    ist(map.toString(), "gap(20)")
  })

  it("updates the length of replaced decorations for changes", () => {
    let text = doc(20)
    let map = mk(text, [Decoration.replace(5, 15, {})])
    map = map.applyChanges([Decoration.set(Decoration.replace(5, 10, {}))], text, o(text.replace(7, 12, [""])),
                           [new ChangedRange(7, 12, 7, 7)])
    ist(map.toString(), "line(15-5)")
  })

  it("stores information about block widgets", () => {
    let text = doc(3, 3, 3), oracle = o(text)
    let map = mk(text, [Decoration.widget(0, {widget: new MyWidget(10), side: -1, block: true}),
                        Decoration.widget(3, {widget: new MyWidget(5), side: 1, block: true}),
                        Decoration.widget(0, {widget: new MyWidget(13), side: -1, block: true})])
    ist(map.toString(), "block(0)-block(0)-line(3)-block(0) gap(7)")
    ist(map.height, 28 + 3 * oracle.lineHeight)
    ist(map.heightAt(0, text, -1), 23)
    ist(map.heightAt(0, text, 1), 23 + oracle.lineHeight)
    ist(map.heightAt(4, text, -1), 28 + oracle.lineHeight)
    map = map.updateHeight(oracle, 0, false, new MeasuredHeights(0, [8, 12, 10, 20, 40, 20]))
    ist(map.toString(), "block(0)-block(0)-line(3)-block(0) line(3) line(3)")
    ist(map.height, 110)
  })

  it("stores information about block ranges", () => {
    let text = doc(3, 3, 3, 3, 3, 3)
    let map = mk(text, [Decoration.replace(4, 11, {widget: new MyWidget(40), block: true}),
                        Decoration.widget(4, {widget: new MyWidget(10), side: -1, block: true}),
                        Decoration.widget(11, {widget: new MyWidget(15), side: 1, block: true}),
                        // This one covers the block widgets around it (due to being inclusive)
                        Decoration.replace(16, 19, {widget: new MyWidget(50), block: true, inclusive: true}),
                        Decoration.widget(16, {widget: new MyWidget(20), side: -1, block: true}),
                        Decoration.widget(19, {widget: new MyWidget(10), side: 1, block: true})])
    ist(map.toString(), "gap(3) block(0)-block(7)-block(0) gap(3) block(3) gap(3)")
    map = map.updateHeight(o(text), 0, false, new MeasuredHeights(4, [5, 5, 5, 10, 5]))
    ist(map.height, 2 * o(text).lineHeight + 30)
  })

  it("handles empty lines correctly", () => {
    let text = doc(0, 0, 0, 0, 0)
    let map = mk(text, [Decoration.widget(1, {widget: new MyWidget(10), side: -1, block: true}),
                        Decoration.replace(2, 2, {widget: new MyWidget(20), block: true}),
                        Decoration.widget(3, {widget: new MyWidget(30), side: 1, block: true})])
    ist(map.toString(), "gap(0) block(0)-line(0) block(0) line(0)-block(0) gap(0)")
    map = map.applyChanges([], text, o(text.replace(1, 3, ["y"])), [new ChangedRange(1, 3, 1, 2)])
    ist(map.toString(), "gap(3)")
  })

  it("joins ranges", () => {
    let text = doc(10, 10, 10, 10)
    let map = mk(text, [Decoration.replace(16, 27, {})])
    ist(map.toString(), "gap(10) line(21-11) gap(10)")
    map = map.applyChanges([], text, o(text.replace(5, 38, ["yyy"])), [new ChangedRange(5, 38, 5, 8)])
    ist(map.toString(), "gap(13)")
  })

  it("joins lines", () => {
    let text = doc(10, 10, 10)
    let map = mk(text, [Decoration.replace(2, 5, {}),
                        Decoration.widget(24, {widget: new MyWidget(20)})])
    ist(map.toString(), "line(10-3) gap(10) line(10:20)")
    map = map.applyChanges([
      Decoration.set([Decoration.replace(2, 5, {}),
                      Decoration.widget(12, {widget: new MyWidget(20)})])
    ], text, o(text.replace(10, 22, [""])), [new ChangedRange(10, 22, 10, 10)])
    ist(map.toString(), "line(20-3:20)")
  })

  it("materializes lines for measured heights", () => {
    let text = doc(10, 10, 10, 10), oracle = o(text)
    let map: HeightMap = mk(text, [])
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

  function depth(heightMap: HeightMap): number {
    let {left, right} = heightMap as any
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
})
