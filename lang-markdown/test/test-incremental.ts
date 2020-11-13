import {Tree} from "lezer-tree"
import ist from "ist"
import {ParseState} from "@codemirror/next/lang-markdown"
import {Text, EditorState, ChangeSpec} from "@codemirror/next/state"
import {compareTree} from "./compare-tree.js"

let doc1 = Text.of(`
Header
---
One **two**
three *four*
five.

> Start of quote
>
> 1. Nested list
>
> 2. More content
>    inside the [list][link]
>
>    Continued item
>
>    ~~~
>    Block of code
>    ~~~
>
> 3. And so on

[link]: /ref
[another]: /one
And a final paragraph.
  ***  
The end.
`.split("\n"))

function parse(d: Text) { return new ParseState(Tree.empty, []).parse(d, 1e9) }

let _state1: null | ParseState = null
function state1() { return _state1 || (_state1 = parse(doc1)) }
function tree1() { return state1().tree }

function update(doc: Text, state: ParseState, changes: ChangeSpec) {
  let changeSet = EditorState.create({doc}).changes(changes)
  let newDoc = changeSet.apply(doc)
  return {doc: newDoc, state: state.applyChanges(changeSet, doc).parse(newDoc, 1e9)}
}

function overlap(a: Tree, b: Tree) {
  let inA = new Set<Tree>(), shared = 0, sharingTo = 0
  for (let cur = a.cursor(); cur.next();) if (cur.tree) inA.add(cur.tree)
  for (let cur = b.cursor(); cur.next();) if (cur.tree && inA.has(cur.tree) && cur.type.is("Block") && cur.from >= sharingTo) {
    shared += cur.to - cur.from
    sharingTo = cur.to
  }
  return Math.round(shared * 100 / b.length)
}

function testChange(change: ChangeSpec, reuse = 10) {
  let {state, doc} = update(doc1, state1(), change)
  ist(overlap(state.tree, tree1()), reuse, ">")
  compareTree(state.tree, parse(doc).tree)
}

describe("Markdown incremental parsing", () => {
  it("can produce the proper tree", () => {
    // Replace 'three' with 'bears'
    let {state} = update(doc1, state1(), {from: 23, to: 28, insert: "bears"})
    compareTree(state.tree, tree1())
  })

  it("reuses nodes from the previous parse", () => {
    // Replace 'three' with 'bears'
    let {state} = update(doc1, state1(), {from: 23, to: 28, insert: "bears"})
    ist(overlap(state1().tree, state.tree), 80, ">")
  })

  it("can reuse content for a change in a block context", () => {
    // Replace 'content' with 'monkeys'
    let {state} = update(doc1, state1(), {from: 92, to: 99, insert: "monkeys"})
    compareTree(state.tree, tree1())
    ist(overlap(state1().tree, state.tree), 20, ">")
  })

  it("can handle deleting a quote mark", () => testChange({from: 82, to: 83}))

  it("can handle adding to a quoted block", () => testChange([{from: 37, insert: "> "}, {from: 43, insert: "> "}]))

  it("can handle a change in a post-linkref paragraph", () => testChange({from: 249, to: 251}))

  it("can handle a change in a paragraph-adjacent linkrefs", () => testChange({from: 230, to: 231}))

  it("can deal with multiple changes applied separately", () => {
    let tr1 = EditorState.create({doc: doc1}).update({changes: {from: 190, to: 191}})
    let tr2 = tr1.state.update({changes: {from: 30, insert: "hi\n\nyou"}})
    let state = state1().applyChanges(tr1.changes, doc1).applyChanges(tr2.changes, tr1.newDoc).parse(tr2.newDoc, 1e9)
    compareTree(state.tree, parse(tr2.newDoc).tree)
  })

  it("works when a change happens directly after a block", () => testChange({from: 150, to: 167}))

  it("works when a change deletes a blank line after a paragraph", () => testChange({from: 207, to: 213}))

  it("doesn't get confused by removing paragraph-breaking markup", () => testChange({from: 264, to: 265}))

  function r(n: number) { return Math.floor(Math.random() * n) }
  function rStr(len: number) {
    let result = "", chars = "\n>x-"
    while (result.length < len) result += chars[r(chars.length)]
    return result
  }

  it("survives random changes", () => {
    for (let i = 0; i < 20; i++) {
      let c = 1 + r(4), changes = []
      for (let i = 0; i < c; i++) {
        let from = r(doc1.length - 1), to = r(2) == 1 ? from : from + r(Math.min(doc1.length - from, 20))
        let iR = r(3), insert = iR == 0 ? "" : iR == 1 ? "\n\n" : rStr(r(5) + 1)
        changes.push({from, to, insert})
      }
      testChange(changes, 0)
    }
  })

  it("can handle large documents", () => {
    let doc = Text.empty
    for (let i = 0; i < 50; i++) doc = doc.append(doc1)
    let state = parse(doc)
    let {state: newState} = update(doc, state, {from: doc.length >> 1, insert: "a\n\nb"})
    ist(overlap(state.tree, newState.tree), 90, ">")
  })

  it("properly re-parses a continued indented code block", () => {
    let doc = Text.of(`
One paragraph to create a bit of string length here

    Code
    Block



Another paragraph that is long enough to create a fragment
`.split("\n"))
    let start = parse(doc)
    let {state: newState, doc: newDoc} = update(doc, start, {from: 76, insert: "    "})
    compareTree(newState.tree, parse(newDoc).tree)
  })

  it("properly re-parses a continued list", () => {
    let doc = Text.of(`
One paragraph to create a bit of string length here

 * List



More content

Another paragraph that is long enough to create a fragment
`.split("\n"))
    let start = parse(doc)
    let {state: newState, doc: newDoc} = update(doc, start, {from: 65, insert: " * "})
    compareTree(newState.tree, parse(newDoc).tree)
  })

  it("can recover from incremental parses that stop in the middle of a list", () => {
    let doc = Text.of(`
1. I am a list item with ***some* emphasized
   content inside** and the parser hopefully stops
   parsing after me.

2. Oh no the list continues.
`.split("\n"))
    let start = new ParseState(Tree.empty, []).parse(doc, -10)
    ist(start.tree.length, doc.length, "<")
    let {state} = update(doc, start, [])
    console.log(state.tree + "")
    ist(state.tree.topNode.lastChild!.from, 1)
  })
})
