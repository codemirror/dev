import {StringStreamCursor} from "../src/stringstreamcursor"
import {Text} from "../../doc/src/text"

const ist = require("ist")

describe("StringStreamCursor", () => {
  it("works with an empty document", () => {
    const cursor = new StringStreamCursor(Text.of([""]), 0)
    ist(cursor.offset, 0)
  })

  it("works with a document that starts with an empty line", () => {
    const cursor = new StringStreamCursor(Text.of(["", "b", ""]), 0)
    ist(cursor.next().string, "")
    ist(cursor.offset, 0)
    ist(cursor.next().string, "b")
    ist(cursor.offset, 1)
    ist(cursor.next().string, "")
    ist(cursor.offset, 3)
  })

  it("works with a document that end with an empty line", () => {
    const cursor = new StringStreamCursor(Text.of(["b", "", ""]), 0)
    ist(cursor.next().string, "b")
    ist(cursor.offset, 0)
    ist(cursor.next().string, "")
    ist(cursor.offset, 2)
    ist(cursor.next().string, "")
    ist(cursor.offset, 3)
  })
})
