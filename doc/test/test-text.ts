import {Text, TextLeaf} from "../src/text"
const ist = require("ist")

function depth(node) {
  return node instanceof TextLeaf ? 0 : 1 + Math.max(...node.children.map(depth))
}

const line = "1234567890".repeat(10)
const midDoc = new Array(200).fill(line).join("\n")

describe("doc", () => {
  it("Creates a balanced tree when loading a document", () => {
    let doc = Text.create(new Array(2000).fill(line).join("\n")), d = depth(doc)
    ist(d, 3, "<=")
    ist(d, 1, ">")
  })

  it("rebalances on insert", () => {
    let doc = Text.create(midDoc)
    let insert = "abc".repeat(200)
    for (let i = 0; i < 10; i++)
      doc = doc.replace(doc.length / 2, doc.length / 2, insert)
    ist(depth(doc), 3, "<=")
    ist(doc.text, midDoc.slice(0, midDoc.length / 2) + "abc".repeat(2000) + midDoc.slice(midDoc.length / 2))
  })

  it("collapses on delete", () => {
    let doc = Text.create(midDoc).replace(10, midDoc.length - 10, "")
    ist(depth(doc), 0)
    ist(doc.length, 20)
    ist(doc.text, line.slice(0, 20))
  })

  it("handles deleting at start", () => {
    ist(Text.create(midDoc + "!").replace(0, 9500, "").text, midDoc.slice(9500) + "!")
  })

  it("handles deleting at end", () => {
    ist(Text.create("?" + midDoc).replace(9500, midDoc.length + 1, "").text, "?" + midDoc.slice(0, 9499))
  })

  it("properly maintains content during editing", () => {
    let str = midDoc, doc = Text.create(str)
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
    let doc = Text.create(str)
    for (let i = 0; i < 400; i++) {
      let start = i == 0 ? 0 : Math.floor(Math.random() * doc.length)
      let end = i == 399 ? doc.length : start + Math.floor(Math.random() * (doc.length - start))
      ist(doc.slice(start, end), str.slice(start, end))
    }
  })

  it("can be compared", () => {
    let doc = Text.create(midDoc), doc2 = Text.create(midDoc)
    ist(doc.eq(doc))
    ist(doc.eq(doc2))
    ist(doc2.eq(doc))
    ist(!doc.eq(doc2.replace(5000, 5000, "y")))
    ist(!doc.eq(doc2.replace(5000, 5001, "y")))
  })

  it("can be compared despite different tree shape", () => {
    ist(Text.create(midDoc).eq(Text.create(midDoc.repeat(3)).replace(1000, (midDoc.length * 2) + 1000, "")))
  })

  it("can compare small documents", () => {
    ist(Text.create("foo").eq(Text.create("foo")))
    ist(!Text.create("foo").eq(Text.create("faa")))
  })

  it("is iterable", () => {
    let found = "", doc = Text.create(midDoc.repeat(5))
    for (let iter = doc.iter(), cur; !(cur = iter.next()).done;) found += cur.value
    ist(found, doc.text)
  })
})
