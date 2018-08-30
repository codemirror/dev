import {Text} from "../../doc/src/text"
import {EditorState} from "../../state/src/state"
import {Decoration} from "../../view/src/decoration"
import {Range} from "../../rangeset/src/rangeset"

import {Decorator, DecorationCache} from "../src/decorationcache"

const ist = require("ist")

const getDecorator: () => [[number, number][], Decorator<null>] = () => {
  const calls = []
  return [calls, (doc, from, to) => {
    calls.push([from, to])
    const arr = []
    if (from < 1 && to > 0) arr.push(Decoration.range(0, 1, {}))
    if (from < 2 && to > 1) arr.push(Decoration.range(1, 2, {}))
    return [arr, [new Range(to, to, null)]]
  }]
}

const arrEql = (a1, a2) => a1.reduce((eql, o1, i) => eql && o1 === a2[i], true)

describe("DecorationCache", () => {
  it("calls the decorator once", () => {
    const [calls, decorator] = getDecorator()
    const cache = new DecorationCache(decorator, Text.of("ab"))
    ist(cache.getDecorations().size, 2)
    ist(calls.length, 1)
    ist(cache.getDecorations().size, 2)
    ist(calls.length, 1)
  })
  it("supports sub-ranges", () => {
    const [calls, decorator] = getDecorator()
    const cache = new DecorationCache(decorator, Text.of("ab"))
    ist(cache.getDecorations(0, 1).size, 1)
    ist(cache.getDecorations().size, 2)
    ist(calls[0], [0, 1], arrEql)
    ist(calls[1], [1, 2], arrEql)
    ist(calls.length, 2)
  })
  it("maps decorations", () => {
    const [calls, decorator] = getDecorator()
    const doc = Text.of("ab")
    let cache = new DecorationCache(decorator, doc)
    ist(cache.getDecorations().size, 2)
    ist(calls.length, 1)
    cache = cache.update(EditorState.create({doc}).transaction.replace(1, 1, "--"))
    ist(cache.getDecorations(0, 1).size, 1)
    ist(calls.length, 1)
  })
  it("correctly passes states", () => {
    const calls = []
    const decorator: Decorator<boolean> = (doc, from, to, state) => {
      calls.push([from, to])
      const text = doc.slice(from, to).join("\n")
      const arr = []
      for (let i = 0; i < text.length; ++i) {
        if (state && text[i] === '_') arr.push(Decoration.range(i, i + 1, {}))
        state = text[i] >= '0' && text[i] <= '9'
      }
      return [arr, [new Range(to, to, state)]]
    }
    const doc = Text.of("a_b1_2a4_b")
    let cache = new DecorationCache(decorator, doc)
    ist(cache.getDecorations(0, 4).size, 0)
    ist(calls[0], [0, 4], arrEql)
    ist(cache.getDecorations(7, 10).size, 2) // FIXME crop result
    ist(calls[1], [4, 10], arrEql)
    ist(cache.getDecorations(4, 7).size, 2) // FIXME crop result
    ist(cache.getDecorations(7, 10).size, 2) // FIXME crop result
    ist(calls.length, 2)
  })
  it("correctly dedupes", () => {
    const calls = []
    const decorator: Decorator<boolean> = (doc, from, to, state) => {
      calls.push([from, to])
      const text = doc.slice(from, to).join("\n")
      const decorations = []
      const states = []
      for (let i = 0; i < text.length; ++i) {
        if (state && text[i] === '_') decorations.push(Decoration.range(i, i + 1, {}))
        state = text[i] >= '0' && text[i] <= '9'
        if (i > 0 && i % 3 == 0) states.push(new Range(i + from, i + from, state))
      }
      return [decorations, states]
    }
    const doc = Text.of("a_b1_2a4_b")
    let cache = new DecorationCache(decorator, doc)
    ist(cache.getDecorations(0, 5).size, 1)
    ist(calls[0], [0, 5], arrEql)
    ist(cache.getDecorations(4, 7).size, 1)
    ist(calls[1], [3, 7], arrEql)
    ist(calls.length, 2)
  })
  it("handles a fragmented cache", () => {
    const calls = []
    const decorator: Decorator<boolean> = (doc, from, to, state) => {
      calls.push([from, to])
      const text = doc.slice(from, to).join("\n")
      const decorations = []
      const states = []
      for (let i = 0; i < text.length; ++i) {
        if (state && text[i] === '_') decorations.push(Decoration.range(i, i + 1, {}))
        state = text[i] >= '0' && text[i] <= '9'
        if (i > 0 && i % 3 == 0) states.push(new Range(i + from, i + from, state))
      }
      return [decorations, states]
    }
    const doc = Text.of("a_b1_2a4_b")
    let cache = new DecorationCache(decorator, doc)
    ist(cache.getDecorations(0, 4).size, 0)
    ist(calls[0], [0, 4], arrEql)
    ist(cache.getDecorations(4, 7).size, 1)
    ist(calls[1], [3, 7], arrEql)
    ist(cache.getDecorations(7, 9).size, 1)
    ist(calls[2], [6, 9], arrEql)
    ist(cache.getDecorations(3, 6).size, 1)
    ist(calls.length, 3)
  })
})
