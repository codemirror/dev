import {Text, TextLeaf, LinePos} from "../src/text"
const ist = require("ist")

function depth(node) {
  return node instanceof TextLeaf ? 0 : 1 + Math.max(...node.children.map(depth))
}

const line = "1234567890".repeat(10)
const lines = new Array(200).fill(line).join("\n")
const doc0 = Text.create(lines)

describe("doc", () => {
  it("Creates a balanced tree when loading a document", () => {
    let doc = Text.create(new Array(2000).fill(line).join("\n")), d = depth(doc)
    ist(d, 3, "<=")
    ist(d, 1, ">")
  })

  it("rebalances on insert", () => {
    let doc = doc0
    let insert = "abc".repeat(200)
    for (let i = 0; i < 10; i++)
      doc = doc.replace(doc.length / 2, doc.length / 2, insert)
    ist(depth(doc), 3, "<=")
    ist(doc.text, lines.slice(0, lines.length / 2) + "abc".repeat(2000) + lines.slice(lines.length / 2))
  })

  it("collapses on delete", () => {
    let doc = doc0.replace(10, lines.length - 10, "")
    ist(depth(doc), 0)
    ist(doc.length, 20)
    ist(doc.text, line.slice(0, 20))
  })

  it("handles deleting at start", () => {
    ist(Text.create(lines + "!").replace(0, 9500, "").text, lines.slice(9500) + "!")
  })

  it("handles deleting at end", () => {
    ist(Text.create("?" + lines).replace(9500, lines.length + 1, "").text, "?" + lines.slice(0, 9499))
  })

  it("can insert on node boundaries", () => {
    let doc = doc0, pos = doc.children[0].length
    ist(doc.replace(pos, pos, "abc").slice(pos, pos + 3), "abc")
  })

  it("can build up a doc by repeated appending", () => {
    let len = 0, doc = Text.create("")
    for (let i = 1; i < 1000; ++i) {
      doc = doc.replace(doc.length, doc.length, "newtext" + i + " ")
      len += 8 + i.toString().length
    }
    ist(doc.length, len)
  })

  it("properly maintains content during editing", () => {
    let str = lines, doc = Text.create(str)
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
    let doc = doc0, doc2 = Text.create(lines)
    ist(doc.eq(doc))
    ist(doc.eq(doc2))
    ist(doc2.eq(doc))
    ist(!doc.eq(doc2.replace(5000, 5000, "y")))
    ist(!doc.eq(doc2.replace(5000, 5001, "y")))
  })

  it("can be compared despite different tree shape", () => {
    ist(doc0.eq(Text.create(lines.repeat(3)).replace(1000, (lines.length * 2) + 1000, "")))
  })

  it("can compare small documents", () => {
    ist(Text.create("foo").eq(Text.create("foo")))
    ist(!Text.create("foo").eq(Text.create("faa")))
  })

  it("is iterable", () => {
    let found = "", doc = Text.create(lines.repeat(5))
    for (let iter = doc.iter(), cur; (cur = iter.next()).length;) found += cur
    ist(found, doc.text)
  })

  it("is iterable in reverse", () => {
    let found = "", doc = Text.create(lines.repeat(5))
    for (let iter = doc.iter(-1), cur; (cur = iter.next()).length;) found = cur + found
    ist(found, doc.text)
  })

  it("is partially iterable", () => {
    let found = "", doc = Text.create(lines.repeat(5))
    for (let iter = doc.iterRange(500, doc.length - 500), cur; (cur = iter.next()).length;) found += cur
    ist(found, doc.slice(500, doc.length - 500))
  })

  it("is partially iterable in reverse", () => {
    let found = ""
    for (let iter = doc0.iterRange(doc0.length - 500, 500), cur; (cur = iter.next()).length;) found = cur + found
    ist(found, doc0.slice(500, doc0.length - 500))
  })

  it("can partially iter over subsections at the start and end", () => {
    ist(doc0.iterRange(0, 1).next(), "1")
    ist(doc0.iterRange(1, 2).next(), "2")
    ist(doc0.iterRange(doc0.length - 1, doc0.length).next(), "0")
    ist(doc0.iterRange(doc0.length - 2, doc0.length - 1).next(), "9")
  })

  it("finds line starts", () => {
    for (let i = 1; i <= 200; i++) ist(doc0.lineStart(i), (i - 1) * 101)
    ist.throws(() => doc0.lineStart(201), /No line/)
    ist.throws(() => doc0.lineStart(0), /No line/)
  })

  it("can retrieve line content", () => {
    for (let i = 1; i <= 200; i++) ist(doc0.getLine(i), line)
    ist.throws(() => doc0.getLine(201), /No line/)
    ist.throws(() => doc0.getLine(0), /No line/)
    let doc = doc0.replace(doc0.length - 99, doc0.length, "?")
    ist(doc.getLine(200), "1?")
  })

  function eqPos(a, b) { return a.line == b.line && a.col == b.col }

  it("finds line positions", () => {
    for (let i = 0; i < doc0.length; i += 5)
      ist(doc0.linePos(i), new LinePos(Math.floor(i / 101) + 1, i % 101), eqPos)
  })

  it("can find line starts and ends", () => {
    for (let i = 0; i < doc0.length; i += 5) {
      ist(doc0.lineStartAt(i), i - (i % 101))
      ist(doc0.lineEndAt(i), i - (i % 101) + 100)
    }
  })
})
