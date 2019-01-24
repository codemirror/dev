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
    return HeightMap.empty().applyChanges([Decoration.set(deco)], o(text),
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
                  Decoration.range(25, 46, {collapsed: true})])
    ist(map.length, 48)
    ist(map.toString(), "line(10:5,20) gap(10) line(26:3,-21)")
  })

  it("ignores irrelevant decorations", () => {
    let map = mk(doc(10, 10, 20, 5),
                 [Decoration.widget(5, {widget: new NoHeightWidget(null)}),
                  Decoration.range(25, 46, {class: "ahah"})])
    ist(map.length, 48)
    ist(map.toString(), "gap(48)")
  })

  it("drops decorations from the tree when they are deleted", () => {
    let text = doc(20)
    let map = mk(text, [Decoration.widget(5, {widget: new MyWidget(20)})])
    ist(map.toString(), "line(20:5,20)")
    map = map.applyChanges([], o(text), [new ChangedRange(5, 5, 5, 5)])
    ist(map.toString(), "line(20)")
  })

  /*
  it("stores information about line widgets", () => {
    let text = doc(3, 3, 3), oracle = o(text)
    let map = mk(text, [Decoration.line(0, {widget: new MyWidget(10), side: -1}),
                        Decoration.line(0, {widget: new MyWidget(5), side: 1}),
                        Decoration.line(0, {widget: new MyWidget(13), side: -1})])
    ist(map.toString(), "line(3:-2,23,-1,5) gap(7)")
    ist(map.heightAt(0, text, -1), 23)
    ist(map.heightAt(0, text, 1), 23 + oracle.lineHeight)
    ist(map.heightAt(4, text, -1), 28 + oracle.lineHeight)
    map = map.updateHeight(oracle, 0, false, new MeasuredHeights(0, [20, -2, 10, 20, -1, 40, 20]))
    ist(map.toString(), "line(3:-2,10,-1,0) line(3:-1,40) line(3)")
    ist(map.height, 110)
  })
  */

  it("joins ranges", () => {
    let text = doc(10, 10, 10, 10)
    let map = mk(text, [Decoration.range(16, 27, {collapsed: true})])
    ist(map.toString(), "gap(10) line(21:5,-11) gap(10)")
    map = map.applyChanges([], o(text.replace(5, 38, ["yyy"])), [new ChangedRange(5, 38, 5, 8)])
    ist(map.toString(), "gap(13)")
  })

  it("joins lines", () => {
    let text = doc(10, 10, 10)
    let map = mk(text, [Decoration.range(2, 5, {collapsed: true}),
                        Decoration.widget(24, {widget: new MyWidget(20)})])
    ist(map.toString(), "line(10:2,-3) gap(10) line(10:2,20)")
    map = map.applyChanges([
      Decoration.set([Decoration.range(2, 5, {collapsed: true}),
                      Decoration.widget(12, {widget: new MyWidget(20)})])
    ], o(text.replace(10, 22, [""])), [new ChangedRange(10, 22, 10, 10)])
    ist(map.toString(), "line(20:2,-3,12,20)")
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
    text = text.replace(0, 31 * 80, [""])
    map = map.applyChanges([], o(text), [new ChangedRange(0, 31 * 80, 0, 0)])
    ist(map.size, 20)
    ist(depth(map), 7, "<")
    let len = text.length
    text = text.replace(len, len, "\nfoo".repeat(200).split("\n"))
    map = map.applyChanges([], o(text), [new ChangedRange(len, len, len, len + 800)])
    map = map.updateHeight(oracle.setDoc(text), 0, false, new MeasuredHeights(len + 1, new Array(200).fill(10)))
    ist(map.size, 220)
    ist(depth(map), 12, "<")
  })

  it("can handle inserting a line break", () => {
    let text = doc(3, 3, 3), oracle = o(text)
    let map = mk(text).updateHeight(oracle, 0, false, new MeasuredHeights(0, [10, 10, 10]))
    ist(map.size, 3)
    oracle.setDoc(text = text.replace(3, 3, ["", ""]))
    map = map.applyChanges([], oracle, [new ChangedRange(3, 3, 3, 4)])
      .updateHeight(oracle, 0, false, new MeasuredHeights(0, [10, 10, 10, 10]))
    ist(map.size, 4)
    ist(map.height, 40)
  })

  it("can handle insertion in the middle of a line", () => {
    let text = doc(3, 3, 3), oracle = o(text)
    let map = mk(text).updateHeight(oracle, 0, false, new MeasuredHeights(0, [10, 10, 10]))
    oracle.setDoc(text = text.replace(5, 5, ["foo", "bar", "baz", "bug"]))
    map = map.applyChanges([], oracle, [new ChangedRange(5, 5, 5, 20)])
      .updateHeight(oracle, 0, false, new MeasuredHeights(0, [10, 10, 10, 10, 10, 10]))
    ist(map.size, 6)
    ist(map.height, 60)
  })
})
