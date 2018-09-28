import {Text} from "../src/text"
const ist = require("ist")

function depth(node: Text): number {
  return !node.children ? 0 : 1 + Math.max(...node.children.map(depth))
}

const line = "1234567890".repeat(10)
const lines = new Array(200).fill(line), text0 = lines.join("\n")
const doc0 = Text.of(lines)

describe("doc", () => {
  it("creates a balanced tree when loading a document", () => {
    let doc = Text.of(new Array(2000).fill(line)), d = depth(doc)
    ist(d, 3, "<=")
    ist(d, 1, ">")
  })

  it("rebalances on insert", () => {
    let doc = doc0
    let insert = "abc".repeat(200), at = Math.floor(doc.length / 2)
    for (let i = 0; i < 10; i++) doc = doc.replace(at, at, [insert])
    ist(depth(doc), 3, "<=")
    ist(doc.toString(), text0.slice(0, at) + "abc".repeat(2000) + text0.slice(at))
  })

  it("collapses on delete", () => {
    let doc = doc0.replace(10, text0.length - 10, [""])
    ist(depth(doc), 0)
    ist(doc.length, 20)
    ist(doc.toString(), line.slice(0, 20))
  })

  it("handles deleting at start", () => {
    ist(Text.of(lines.slice(0, -1).concat([line + "!"])).replace(0, 9500, [""]).toString(), text0.slice(9500) + "!")
  })

  it("handles deleting at end", () => {
    ist(Text.of(["?" + line].concat(lines.slice(1))).replace(9500, text0.length + 1, [""]).toString(), "?" + text0.slice(0, 9499))
  })

  it("can insert on node boundaries", () => {
    let doc = doc0, pos = doc.children![0].length
    ist(doc.replace(pos, pos, ["abc"]).slice(pos, pos + 3), "abc")
  })

  it("can build up a doc by repeated appending", () => {
    let doc = Text.of([""]), text = ""
    for (let i = 1; i < 1000; ++i) {
      let add = "newtext" + i + " "
      doc = doc.replace(doc.length, doc.length, [add])
      text += add
    }
    ist(doc.toString(), text)
  })

  it("properly maintains content during editing", () => {
    let str = text0, doc = doc0
    for (let i = 0; i < 200; i++) {
      let insPos = Math.floor(Math.random() * doc.length)
      let insChar = String.fromCharCode("A".charCodeAt(0) + Math.floor(Math.random() * 26))
      str = str.slice(0, insPos) + insChar + str.slice(insPos)
      doc = doc.replace(insPos, insPos, [insChar])
      let delFrom = Math.floor(Math.random() * doc.length)
      let delTo = Math.min(doc.length, delFrom + Math.floor(Math.random() * 20))
      str = str.slice(0, delFrom) + str.slice(delTo)
      doc = doc.replace(delFrom, delTo, [""])
    }
    ist(doc.toString(), str)
  })

  it("returns the correct strings for slice", () => {
    let text = []
    for (let i = 0; i < 1000; i++) text.push(String(i).padStart(4, "0"))
    let doc = Text.of(text)
    let str = text.join("\n")
    for (let i = 0; i < 400; i++) {
      let start = i == 0 ? 0 : Math.floor(Math.random() * doc.length)
      let end = i == 399 ? doc.length : start + Math.floor(Math.random() * (doc.length - start))
      ist(doc.slice(start, end, "\n"), str.slice(start, end))
    }
  })

  it("can be compared", () => {
    let doc = doc0, doc2 = Text.of(lines)
    ist(doc.eq(doc))
    ist(doc.eq(doc2))
    ist(doc2.eq(doc))
    ist(!doc.eq(doc2.replace(5000, 5000, ["y"])))
    ist(!doc.eq(doc2.replace(5000, 5001, ["y"])))
  })

  it("can be compared despite different tree shape", () => {
    ist(doc0.replace(100, 201, ["abc"]).eq(Text.of([line + "abc"].concat(lines.slice(2)))))
  })

  it("can compare small documents", () => {
    ist(Text.of(["foo", "bar"]).eq(Text.of(["foo", "bar"])))
    ist(!Text.of(["foo", "bar"]).eq(Text.of(["foo", "baz"])))
  })

  it("is iterable", () => {
    for (let iter = doc0.iter(), build = "";;) {
      let {value, lineBreak, done} = iter.next()
      if (done) {
        ist(build, text0)
        break
      }
      if (lineBreak) {
        build += "\n"
      } else {
        ist(value.indexOf("\n"), -1)
        build += value
      }
    }
  })

  it("is iterable in reverse", () => {
    let found = ""
    for (let iter = doc0.iter(-1); !iter.next().done;) found = iter.value + found
    ist(found, text0)
  })

  it("is partially iterable", () => {
    let found = ""
    for (let iter = doc0.iterRange(500, doc0.length - 500); !iter.next().done;) found += iter.value
    ist(JSON.stringify(found), JSON.stringify(text0.slice(500, text0.length - 500)))
  })

  it("is partially iterable in reverse", () => {
    let found = ""
    for (let iter = doc0.iterRange(doc0.length - 500, 500); !iter.next().done;) found = iter.value + found
    ist(found, text0.slice(500, text0.length - 500))
  })

  it("can partially iter over subsections at the start and end", () => {
    ist(doc0.iterRange(0, 1).next().value, "1")
    ist(doc0.iterRange(1, 2).next().value, "2")
    ist(doc0.iterRange(doc0.length - 1, doc0.length).next().value, "0")
    ist(doc0.iterRange(doc0.length - 2, doc0.length - 1).next().value, "9")
  })

  it("can iterate over document lines", () => {
    let lines = []
    for (let i = 0; i < 200; i++) lines.push("line " + i)
    for (let iter = Text.of(lines).iterLines(), i = 0; !iter.next().done; i++) {
      ist(iter.value, "line " + i)
      ist(i < 200)
    }
  })

  it("iterates lines in empty documents", () => {
    let result = []
    for (let iter = Text.of([""]).iterLines(); !iter.next().done;) result.push(iter.value)
    ist(JSON.stringify(result), JSON.stringify([""]))
  })

  it("iterates over empty lines", () => {
    let lines = ["", "foo", "", "", "bar", "", ""], result = []
    for (let iter = Text.of(lines).iterLines(); !iter.next().done;) result.push(iter.value)
    ist(JSON.stringify(result), JSON.stringify(lines))
  })

  it("iterates over long lines", () => {
    let long = line.repeat(100), result = []
    for (let iter = Text.of([long]).iterLines(); !iter.next().done;) result.push(iter.value)
    ist(JSON.stringify(result), JSON.stringify([long]))
  })

  it("can get line info by line number", () => {
    ist.throws(() => doc0.line(0), /Invalid line/)
    ist.throws(() => doc0.line(doc0.lines + 1), /Invalid line/)
    for (let i = 1; i < doc0.lines; i += 5) {
      let l = doc0.line(i)
      ist(l.start, (i - 1) * 101)
      ist(l.end, i * 101 - 1)
      ist(l.number, i)
      ist(l.slice(), line)
    }
  })

  it("can get line info by position", () => {
    ist.throws(() => doc0.lineAt(-10), /Invalid position/)
    ist.throws(() => doc0.lineAt(doc0.length + 1), /Invalid position/)
    for (let i = 0; i < doc0.length; i += 5) {
      let l = doc0.lineAt(i)
      ist(l.start, i - (i % 101))
      ist(l.end, i - (i % 101) + 100)
      ist(l.number, Math.floor(i / 101) + 1)
      ist(l.slice(), line)
    }
  })

  it("can delete a range at the start of a child node", () => {
    ist(doc0.replace(0, 100, ["x"]).toString(), "x" + text0.slice(100))
  })
})
