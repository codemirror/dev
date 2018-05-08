import {Text} from "../src/text"
import {changedRanges} from "../src/diff"
const ist = require("ist")

let noise = ""
for (let i = 1; i <= 10000; i++) noise += String.fromCharCode((i % 94) + 32)

function test(size, ...changes) {
  let doc = Text.create(noise.slice(0, size)), startDoc = doc, ranges = []
  for (let i = 0, off = 0; i < changes.length; i++) {
    let [from, to, size] = changes[i]
    doc = doc.replace(from + off, to + off, "×".repeat(size))
    ranges.push({fromA: from, toA: to, fromB: from + off, toB: from + off + size})
    off += size - (to - from)
  }
  ist(JSON.stringify(changedRanges(startDoc, doc)), JSON.stringify(ranges))
}

describe("changedRanges", () => {
  it("spots a single changed range", () => test(50, [20, 21, 1]))

  it("spots a single changed range in a large document", () => test(10000, [5000, 5020, 4]))

  it("spots a big deleted range", () => test(10000, [1000, 9000, 0]))

  it("spots a big inserted range", () => test(1000, [500, 500, 4000]))

  it("can handle multiple changes", () => test(2000, [100, 101, 0], [1800, 1800, 1]))

  it("can handle changes close to each other", () => test(100, [40, 41, 2], [43, 43, 1]))

  it("can handle changes spread over large doc", () =>
     test(10000, [40, 41, 2], [43, 43, 1], [700, 800, 0], [7044, 7045, 2], [7046, 7046, 1], [7122, 7123, 1]))
})
