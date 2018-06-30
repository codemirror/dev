const ist = require("ist")
import {Change, ChangeSet} from "../src/state"

function testMapping(mapping, ...cases) {
  let inverted = mapping.partialMapping(mapping.length, 0)
  for (let i = 0; i < cases.length; i++) {
    let [from, to, {bias = 1, trackDel = false, lossy = false} = {}] = cases[i]
    ist(mapping.mapPos(from, bias, trackDel), to)
    if (!lossy) ist(inverted.mapPos(to, bias), from)
  }
}

function mk(...args) {
  let changes = [], mirror = []
  for (let arg of args) {
    if (Array.isArray(arg)) changes.push(new Change(arg[0], arg[1], "x".repeat(arg[2])))
    else for (let from in arg) mirror.push(+from, arg[from])
  }
  return new ChangeSet(changes, mirror)
}

describe("Mapping", () => {
  it("can map through a single insertion", () => {
    testMapping(mk([2, 2, 4]), [0, 0], [2, 6], [2, 2, {bias: -1}], [3, 7])
  })

  it("can map through a single deletion", () => {
    testMapping(mk([2, 6, 0]), [0, 0], [2, 2, {bias: -1}], [3, 2, {lossy: true}], [6, 2], [6, 2, {bias: -1, lossy: true}], [7, 3])
  })

  it("can map through a single replace", () => {
    testMapping(mk([2, 6, 4]), [0, 0], [2, 2], [4, 6, {lossy: true}], [4, 2, {bias: -1, lossy: true}], [6, 6, {bias: -1}], [8, 8])
  })

  it("can map through a mirrored delete-insert", () => {
    testMapping(mk([2, 6, 0], [2, 2, 4], {0: 1}), [0, 0], [2, 2], [4, 4], [6, 6], [7, 7])
  })

  it("cap map through a mirrored insert-delete", () => {
    testMapping(mk([2, 2, 4], [2, 6, 0], {0: 1}), [0, 0], [2, 2], [3, 3])
  })

  it("can map through an delete-insert with an insert in between", () => {
    testMapping(mk([2, 6, 0], [1, 1, 1], [3, 3, 4], {0: 2}), [0, 0], [1, 2], [4, 5], [6, 7], [7, 8])
  })
})
