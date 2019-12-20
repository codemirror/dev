import {SearchCursor} from ".."
import {Text} from "../../text"
import ist from "ist"

function testMatches(cursor: SearchCursor, expected: [number, number][]) {
  let matches = []
  while (!cursor.next().done) matches.push([cursor.value.from, cursor.value.to])
  ist(JSON.stringify(matches), JSON.stringify(expected))
}

describe("SearchCursor", () => {
  it("finds all matches in a simple string", () => {
    testMatches(new SearchCursor(Text.of(["one two one two one"]), "one"),
                [[0, 3], [8, 11], [16, 19]])
  })

  it("finds only matches in the given region", () => {
    testMatches(new SearchCursor(Text.of(["one two one two one"]), "one", 2, 17),
                [[8, 11]])
  })

  it("can cross lines", () => {
    testMatches(new SearchCursor(Text.of(["one two", "one two", "one"]), "one"),
                [[0, 3], [8, 11], [16, 19]])
  })

  it("can normalize case", () => {
    testMatches(new SearchCursor(Text.of(["ONE two oNe two one"]), "one", 0, 19, s => s.toLowerCase()),
                [[0, 3], [8, 11], [16, 19]])
  })

  it("doesn't get confused by expanding transforms", () => {
    testMatches(new SearchCursor(Text.of(["Auf die Straße"]), "straße", 0, 14, s => s.toUpperCase()),
                [[8, 14]])
  })

  it("normalizes composed chars", () => {
    testMatches(new SearchCursor(Text.of(["héé"]), "héé"), // First one is composed, second decomposed
                [[0, 3]])
    testMatches(new SearchCursor(Text.of(["héé"]), "héé"), // First one is decomposed, second composed
                [[0, 5]])
  })

  it("can match across lines", () => {
    testMatches(new SearchCursor(Text.of(["one two", "three four"]), "two\nthree"),
                [[4, 13]])
  })
})
