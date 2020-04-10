import {EditorState, Transaction, Change, MapMode} from "@codemirror/next/state"
import {collab} from "@codemirror/next/collab"
import ist from "ist"

let rebaseUpdates = (collab as any).rebase

function changePairs(tr: Transaction) {
  let pairs: {change: Change, inverted: Change, origin: any}[] = []
  for (let inv = tr.invertedChanges(), i = 0, j = inv.length - 1; j >= 0; i++, j--)
    pairs.push({change: tr.changes.changes[i], inverted: inv.changes[j], origin: null})
  return pairs
}

function readTags(str: string): {value: string, tag: {[name: string]: number}} {
  let tag: {[name: string]: number} = Object.create(null)
  let value = ""
  for (let i = 0;;) {
    let next = str.indexOf("<", i)
    if (next < 0) return {value: value + str.slice(i), tag}
    let end = str.indexOf(">", next + 1)
    console.assert(end > -1)
    value += str.slice(i, next)
    tag[str.slice(next + 1, end)] = value.length
    i = end + 1
  }
}

function runRebase(tags: {[name: string]: number}, transactions: Transaction[], expected: string) {
  let start = transactions[0].startState, full = start.t()
  for (let tr of transactions) {
    let rebased = tr.startState.t()
    let start = tr.changes.length + full.changes.length
    rebaseUpdates(changePairs(tr), full.changes.changes.map(change => ({change})), rebased)
    for (let i = start; i < rebased.changes.length; i++) full.change(rebased.changes.changes[i])
  }

  let exp = readTags(expected)
  ist(full.doc.toString(), exp.value)
  for (let name in tags) {
    let mapped = full.changes.mapPos(tags[name], -1, MapMode.TrackDel)
    ist(mapped < 0 ? undefined : mapped, exp.tag[name])
  }
}

function permute<T>(array: T[]): T[][] {
  if (array.length < 2) return [array]
  let result = []
  for (let i = 0; i < array.length; i++) {
    let others: T[][] = permute(array.slice(0, i).concat(array.slice(i + 1)))
    for (let j = 0; j < others.length; j++)
      result.push([array[i]].concat(others[j]))
  }
  return result
}

function rebase(start: string, expected: string, ...clients: ((tr: Transaction) => Transaction)[]) {
  let {value, tag} = readTags(start), state = EditorState.create({doc: value})
  runRebase(tag, clients.map(cl => cl(state.t())), expected)
}

function rebase$(start: string, expected: string, ...clients: ((tr: Transaction) => Transaction)[]) {
  let {value, tag} = readTags(start), state = EditorState.create({doc: value})
  for (let perm of permute(clients.map(cl => cl(state.t()))))
    runRebase(tag, perm, expected)
}

describe("rebaseChanges", () => {
  it("supports concurrent typing", () =>
     rebase$("h<1>ell<2>o", "h<1>Xell<2>Yo",
             tr => tr.replace(1, 1, "X"),
             tr => tr.replace(4, 4, "Y")))

  it("support multiple concurrently typed chars", () =>
     rebase$("h<1>ell<2>o", "h<1>XYZell<2>UVo",
             tr => tr.replace(1, 1, "X").replace(2, 2, "Y").replace(3, 3, "Z"),
             tr => tr.replace(4, 4, "U").replace(5, 5, "V")))

  it("supports three concurrent typers", () =>
     rebase$("h<1>ell<2>o th<3>ere", "h<1>Xell<2>Yo th<3>Zere",
             tr => tr.replace(1, 1, "X"),
             tr => tr.replace(4, 4, "Y"),
             tr => tr.replace(8, 8, "Z")))

  it("handles insertions in deleted content", () =>
     rebase$("hello<1> wo<2>rld<3>!", "hello<1><3>!",
             tr => tr.replace(5, 11, ""),
             tr => tr.replace(8, 8, "X")))

  it("allows deleting the same content twice", () =>
     rebase("hello<1> wo<2>rld<3>!", "hello<1><3>!",
            tr => tr.replace(5, 11, ""),
            tr => tr.replace(5, 11, "")))

  it("handles overlapping changes", () =>
     rebase("one two three four", "ONE TWOTHREE four",
            tr => tr.replace(0, 7, "ONE TWO"),
            tr => tr.replace(4, 13, "THREE")))

  it("deletes inserts in replaced context", () =>
     rebase("b<before>efore o<1>ne t<2>wo thr<3>ee a<after>fter",
            "b<before>efore o<1>a b c<3>ee a<after>fter",
            tr => tr.replace(8, 18, "a b c"),
            tr => tr.replace(14, 14, "ayay")))

  it("maps through inserts", () =>
     rebase$("X<1>X<2>X", "X<1>helloX<2>gbyeX",
             tr => tr.replace(1, 1, "hello"),
             tr => tr.replace(2, 2, "goodbye").replace(3, 6, "")))

  it("handles inserts at the same place", () =>
     rebase("abcd", "abXYZDEFcd",
            tr => tr.replace(2, 2, "X").replace(3, 3, "Y").replace(4, 4, "Z"),
            tr => tr.replace(2, 2, "D").replace(3, 3, "E").replace(4, 4, "F")))
})
