import {IteratorStringStream} from "../src/IteratorStringStream"

const ist = require("ist")

const getDummyText = (arr: string[]) => {
  return {
    iter() { return { next() { return arr.shift() || "" } } },
    length: arr.reduce((sum, s) => sum + s.length, 0)
  }
}

describe("IteratorStringStream", () => {
  it("works with an empty document", () => {
    const stream = new IteratorStringStream(getDummyText([""]))
    ist(stream.eof())
  })

  it("works with a document that starts with an empty line", () => {
    const stream = new IteratorStringStream(getDummyText(["\n", "b\n"]))
    ist(stream.offset, 0)
    ist(stream.string, "")
    stream.nextLine()
    ist(stream.offset, 1)
    ist(stream.string, "b")
    stream.nextLine()
    ist(stream.eof())
  })

  it("works with a document that end with an empty line", () => {
    const stream = new IteratorStringStream(getDummyText(["b\n", "\n"]))
    ist(stream.offset, 0)
    ist(stream.string, "b")
    stream.nextLine()
    ist(stream.offset, 2)
    ist(stream.string, "")
    stream.nextLine()
    ist(stream.eof())
  })
})
