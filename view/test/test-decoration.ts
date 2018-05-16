import {Decoration, DecorationSet} from "../src/decoration"
const ist = require("ist")

function depth(decoSet: DecorationSet): number {
  return 1 + Math.max(0, ...decoSet.children.map(depth))
}
function maxSize(decoSet: DecorationSet): number {
  return Math.max(decoSet.local.length, ...decoSet.children.map(maxSize))
}
function size(decoSet: DecorationSet): number {
  return decoSet.children.reduce((a, b) => a + size(b), decoSet.local.length)
}
function checkLengthAndSize(decoSet: DecorationSet) {
  ist(decoSet.length, 0, ">=")
  ist(size(decoSet), decoSet.size)
  let off = 0
  for (let i = 0; i < decoSet.children.length; i++) {
    let child = decoSet.children[i]
    checkLengthAndSize(child)
    off += child.length
  }
  ist(off, decoSet.length, "<=")
  for (let i = 0; i < decoSet.local.length; i++) {
    let deco = decoSet.local[i]
    ist(deco.to, deco.from, ">=")
    ist(deco.from, 0, ">=")
    ist(deco.to, decoSet.length, "<=")
  }
}

let smallDecorations = []
for (let i = 0; i < 5000; i++) {
  smallDecorations.push(Decoration.create(i, i + (i % 4), {pos: i}))
}

describe("DecorationSet", () => {
  it("balances a decoration tree", () => {
    let t = Date.now()
    let set = DecorationSet.create(smallDecorations.concat([
      Decoration.create(1000, 4000, {pos: 1000}),
      Decoration.create(2000, 3000, {pos: 2000})
    ]))
    console.log(Date.now() - t)
    ist(set.size, 5002)
    ist(size(set), 5002)
    ist(depth(set), 4, "<")
    ist(maxSize(set), 64, "<=")
    checkLengthAndSize(set)
    let collect = []
    set.collect(collect, 0)
    ist(collect.length, 5002)
    collect.forEach(deco => ist(deco.spec.pos, deco.from))
  })
})
