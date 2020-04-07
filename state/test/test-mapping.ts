import ist from "ist"
import {ChangeDesc, ChangeSet} from "@codemirror/next/state"

function testMapping(mapping: ChangeSet<ChangeDesc>, ...cases: any[][]) {
  let inverted = mapping.partialMapping(mapping.length, 0)
  for (let i = 0; i < cases.length; i++) {
    let [from, to, {bias = 1, trackDel = false, lossy = trackDel || false} = {}] = cases[i] as any
    ist(mapping.mapPos(from, bias, trackDel), to)
    if (!mapping.mirror.length && !trackDel) ist(mapThrough(mapping.changes, from, bias), to)
    if (!lossy) ist(inverted.mapPos(to, bias), from)
  }
}

function mapThrough(changes: readonly ChangeDesc[], pos: number, bias: number): number {
  for (let change of changes) pos = change.mapPos(pos, bias)
  return pos
}

function mk(...args: (number[] | {[key: number]: number})[]) {
  let changes = [], mirror = []
  for (let arg of args) {
    if (Array.isArray(arg)) changes.push(new ChangeDesc(arg[0], arg[1], arg[2]))
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

  it("can map through a mirrored insert-delete", () => {
    testMapping(mk([2, 2, 4], [2, 6, 0], {0: 1}), [0, 0], [2, 2], [3, 3])
  })

  it("allows insertions next to a mirrored change to influence mapping", () => {
    testMapping(mk([2, 2, 4], [2, 2, 1], [3, 7, 0], {0: 2}), [2, 2, {bias: -1}])
  })

  it("can map through an delete-insert with an insert in between", () => {
    testMapping(mk([2, 6, 0], [1, 1, 1], [3, 3, 4], {0: 2}), [0, 0], [1, 2], [4, 5], [6, 7], [7, 8])
  })

  it("tracks deletions when asked", () => {
    let t = {trackDel: true}
    testMapping(mk([0, 3, 0], [2, 6, 6]), [0, 0, t], [1, -1, t], [4, 1, t], [5, 2, t], [6, -1, t], [11, 10, t], [14, 13, t])
  })

  it("maps back when bias equals 0", () => {
    testMapping(mk([1, 1, 1]), [1, 1, {bias: 0}], [1, 2, {bias: 1}])
  })
})
