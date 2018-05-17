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
function avgSize(decoSet: DecorationSet): number {
  let total = 0, count = 0
  function scan(set: DecorationSet) {
    total += set.local.length + set.children.length
    count++
    set.children.forEach(scan)
  }
  scan(decoSet)
  return total / count
}
function checkSet(decoSet: DecorationSet, offset: number = 0) {
  ist(decoSet.length, 0, ">=")
  ist(size(decoSet), decoSet.size)
  let off = 0
  for (let i = 0; i < decoSet.children.length; i++) {
    let child = decoSet.children[i]
    checkSet(child, offset + off)
    off += child.length
  }
  ist(off, decoSet.length, "<=")
  for (let i = 0; i < decoSet.local.length; i++) {
    let deco = decoSet.local[i]
    if (deco.spec.pos != null) ist(offset + deco.from, deco.spec.pos)
    ist(deco.to, deco.from, ">=")
    ist(deco.from, 0, ">=")
    ist(deco.to, decoSet.length, "<=")
  }
}

let smallDecorations = []
for (let i = 0; i < 5000; i++) {
  smallDecorations.push(Decoration.create(i, i + (i % 4), {pos: i}))
}
let set0 = DecorationSet.create(smallDecorations)

describe("DecorationSet", () => {
  it("creates a balanced decoration tree", () => {
    let set = DecorationSet.create(smallDecorations.concat([
      Decoration.create(1000, 4000, {pos: 1000}),
      Decoration.create(2000, 3000, {pos: 2000})
    ]))
    ist(set.size, 5002)
    ist(size(set), 5002)
    ist(depth(set), 4, "<")
    ist(maxSize(set), 64, "<=")
    ist(avgSize(set), 24, ">")
    checkSet(set)
  })

  describe("update", () => {
    it("can add decorations to an existing set", () => {
      let set = set0.update([
        Decoration.create(2000, 2000, {pos: 2000}),
        Decoration.create(2008, 2200, {pos: 2008})
      ])
      ist(set.size, 5002)
      checkSet(set)
      ist(set.children[0], set0.children[0])
      ist(set.children[set.children.length - 1], set0.children[set0.children.length - 1])
    })

    it("can add a large amount of decorations", () => {
      let set0 = DecorationSet.create([
        Decoration.create(0, 0, {pos: 0}),
        Decoration.create(100, 100, {pos: 100}),
        Decoration.create(2, 4000, {pos: 2}),
        Decoration.create(10000, 10000, {pos: 10000})
      ])
      let set = set0.update(smallDecorations)
      ist(set.size, 5004)
      checkSet(set)
    })

    it("can filter decorations", () => {
      let set = set0.update([], from => from >= 2500)
      ist(set.size, 2500)
      checkSet(set)
      ist(set.children[set.children.length - 1], set0.children[set0.children.length - 1])
    })

    it("can filter all over", () => {
      let set = set0.update([], from => (from % 200) >= 100)
      ist(set.size, 2500)
      checkSet(set)
    })

    it("can add and remove in one go", () => {
      let set = set0.update([Decoration.create(25, 30, {pos: 25})], from => from % 1000 > 0)
      ist(set.size, 4996)
      checkSet(set)
    })

    it("collapses the tree when removing almost all decorations", () => {
      let set = set0.update([], from => from == 500 || from == 501)
      ist(set.size, 2)
      ist(depth(set), 1)
    })

    it("doesn't call filter on decorations outside the filter range", () => {
      let called = 0
      set0.update([], () => (called++, true), 2000, 2005)
      ist(called, 10, "<")
    })

    it("reuses unchanged nodes", () => {
      ist(set0.update([], () => true), set0)
    })
  })
})
