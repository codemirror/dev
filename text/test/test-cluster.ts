import {findClusterBreak, countColumn, findColumn} from "@codemirror/next/text"
import ist from "ist"

describe("findClusterBreak", () => {
  function test(spec: string) {
    it(spec, () => {
      let breaks = [], next: number
      while ((next = spec.indexOf("|")) > -1) {
        breaks.push(next)
        spec = spec.slice(0, next) + spec.slice(next + 1)
      }
      let found = []
      for (let i = 0;;) {
        let next = findClusterBreak(spec, i)
        if (next == spec.length) break
        found.push(i = next)
      }
      ist(found.join(","), breaks.join(","))
    })
  }
  
  test("a|b|c|d")
  test("a|é̠|ő|x")
  test("😎|🙉")
  test("👨‍🎤|💪🏽|👩‍👩‍👧‍👦|❤")
  test("🇩🇪|🇫🇷|🇪🇸|x|🇮🇹")
})

describe("countColumn", () => {
  it("counts characters", () => ist(countColumn("abc", 0, 4), 3))

  it("counts tabs correctly", () => ist(countColumn("a\t\tbc\tx", 0, 4), 13))

  it("handles clusters", () => ist(countColumn("a😎🇫🇷", 0, 4), 3))
})

describe("findColumn", () => {
  it("finds positions", () => ist(findColumn("abc", 0, 3, 4).offset, 3))

  it("counts tabs", () => ist(findColumn("a\tbc", 0, 4, 4).offset, 2))

  it("handles clusters", () => ist(findColumn("a😎🇫🇷bc", 0, 4, 4).offset, 8))
})
