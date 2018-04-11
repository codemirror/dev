import {Rope, Leaf, Node} from "../src/rope"
const ist = require("ist")

function depth(node) {
  return node instanceof Leaf ? 0 : 1 + Math.max(...node.children.map(depth))
}

const line = "x".repeat(100)
const midDoc = new Array(200).fill(line).join("\n")

describe("doc", () => {
  it("Creates a balanced tree when loading a document", () => {
    let doc = Rope.create(new Array(2000).fill(line).join("\n")), d = depth(doc)
    ist(d, 3, "<=")
    ist(d, 1, ">")
  })

  it("rebalances on insert", () => {
    let doc = Rope.create(midDoc)
    let insert = "abc".repeat(200)
    for (let i = 0; i < 10; i++)
      doc = doc.replace(doc.length / 2, doc.length / 2, insert)
    ist(depth(doc), 3, "<=")
    ist(doc.text, midDoc.slice(0, midDoc.length / 2) + "abc".repeat(2000) + midDoc.slice(midDoc.length / 2))
  })

  it("collapses on delete", () => {
    let doc = Rope.create(midDoc).replace(10, midDoc.length - 10, "")
    ist(depth(doc), 0)
    ist(doc.length, 20)
    ist(doc.text, "x".repeat(20))
  })

  it("handles deleting at start", () => {
    ist(Rope.create(midDoc + "!").replace(0, 9500, "").text, midDoc.slice(9500) + "!")
  })

  it("handles deleting at end", () => {
    ist(Rope.create("?" + midDoc).replace(9500, midDoc.length + 1, "").text, "?" + midDoc.slice(0, 9499))
  })

  it("properly maintains content during editing", () => {
    let str = midDoc, doc = Rope.create(str)
    for (let i = 0; i < 200; i++) {
      let insPos = Math.floor(Math.random() * doc.length)
      let insChar = String.fromCharCode("A".charCodeAt(0) + Math.floor(Math.random() * 26))
      str = str.slice(0, insPos) + insChar + str.slice(insPos)
      doc = doc.replace(insPos, insPos, insChar)
      let delFrom = Math.floor(Math.random() * doc.length)
      let delTo = Math.min(doc.length, delFrom + Math.floor(Math.random() * 20))
      str = str.slice(0, delFrom) + str.slice(delTo)
      doc = doc.replace(delFrom, delTo, "")
    }
    ist(doc.text, str)
  })

  it("returns the correct strings for slice", () => {
    let str = ""
    for (let i = 0; i < 1000; i++) str += String(i).padStart(4, "0") + "\n"
    let doc = Rope.create(str)
    for (let i = 0; i < 400; i++) {
      let start = i == 0 ? 0 : Math.floor(Math.random() * doc.length)
      let end = i == 399 ? doc.length : start + Math.floor(Math.random() * (doc.length - start))
      ist(doc.slice(start, end), str.slice(start, end))
    }
  })
})
