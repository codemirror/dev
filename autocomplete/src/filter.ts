import {codePointAt, codePointSize, fromCodePoint} from "@codemirror/next/text"

// Scores are counted from 0 (great match) down to negative numbers,
// assigning specific penalty values for specific shortcomings.
const enum Penalty {
  Gap = -1100,      // Added for each gap in the match (not counted for by-word matches)
  NotStart = -700,  // The match doesn't start at the start of the word
  CaseFold = -200,  // At least one character needed to be case-folded to match
  ByWord = -100     // The match is by-word, meaning each char in the pattern matches the start of a word in the string
}

const enum Tp { NonWord, Upper, Lower }

// A pattern matcher for fuzzy completion matching. Create an instance
// once for a pattern, and then use that to match any number of
// completions.
export class FuzzyMatcher {
  chars: number[] = []
  folded: number[] = []
  astral: boolean

  // Buffers reused by calls to `match` to track matched character
  // positions.
  any: number[] = []
  precise: number[] = []
  byWord: number[] = []

  constructor(readonly pattern: string) {
    for (let p = 0; p < pattern.length;) {
      let char = codePointAt(pattern, p), size = codePointSize(char)
      this.chars.push(char)
      let part = pattern.slice(p, p + size), upper = part.toUpperCase()
      this.folded.push(codePointAt(upper == part ? part.toLowerCase() : upper, 0))
      p += size
    }
    this.astral = pattern.length != this.chars.length
  }

  // Matches a given word (completion) against the pattern (input).
  // Will return null for no match, and otherwise an array that starts
  // with the match score, followed by any number of `from, to` pairs
  // indicating the matched parts of `word`.
  //
  // The score is a number that is more negative the worse the match
  // is. See `Penalty` above.
  match(word: string): number[] | null {
    if (this.pattern.length == 0) return [0]
    if (word.length < this.pattern.length) return null
    let {chars, folded, any, precise, byWord} = this
    // For single-character queries, only match when they occur right
    // at the start
    if (chars.length == 1) {
      let first = codePointAt(word, 0)
      return first == chars[0] ? [0, 0, codePointSize(first)]
        : first == folded[0] ? [Penalty.CaseFold, 0, codePointSize(first)] : null
    }
    let direct = word.indexOf(this.pattern)
    if (direct == 0) return [0, 0, this.pattern.length]

    let len = chars.length, anyTo = 0
    if (direct < 0) {
      for (let i = 0, e = Math.min(word.length, 200); i < e && anyTo < len;) {
        let next = codePointAt(word, i)
        if (next == chars[anyTo] || next == folded[anyTo]) any[anyTo++] = i
        i += codePointSize(next)
      }
      // No match, exit immediately
      if (anyTo < len) return null
    }

    let preciseTo = 0
    let byWordTo = 0, byWordFolded = false
    let adjacentTo = 0, adjacentStart = -1, adjacentEnd = -1
    for (let i = 0, e = Math.min(word.length, 200), prevType = Tp.NonWord; i < e && byWordTo < len;) {
      let next = codePointAt(word, i)
      if (direct < 0) {
        if (preciseTo < len && next == chars[preciseTo])
          precise[preciseTo++] = i
        if (adjacentTo < len) {
          if (next == chars[adjacentTo] || next == folded[adjacentTo]) {
            if (adjacentTo == 0) adjacentStart = i
            adjacentEnd = i
            adjacentTo++
          } else {
            adjacentTo = 0
          }
        }
      }
      let ch, type = next < 0xff
        ? (next >= 48 && next <= 57 || next >= 97 && next <= 122 ? Tp.Lower : next >= 65 && next <= 90 ? Tp.Upper : Tp.NonWord)
        : ((ch = fromCodePoint(next)) != ch.toLowerCase() ? Tp.Upper : ch != ch.toUpperCase() ? Tp.Lower : Tp.NonWord)
      if (type == Tp.Upper || prevType == Tp.NonWord && type != Tp.NonWord &&
          (this.chars[byWordTo] == next || (this.folded[byWordTo] == next && (byWordFolded = true))))
        byWord[byWordTo++] = i
      prevType = type
      i += codePointSize(next)
    }

    if (byWordTo == len && byWord[0] == 0)
      return this.result(Penalty.ByWord + (byWordFolded ? Penalty.CaseFold : 0), byWord, word)
    if (adjacentTo == len && adjacentStart == 0)
      return [Penalty.CaseFold, 0, adjacentEnd]
    if (direct > -1)
      return [Penalty.NotStart, direct, direct + this.pattern.length]
    if (adjacentTo == len)
      return [Penalty.CaseFold + Penalty.NotStart, adjacentStart, adjacentEnd]
    if (byWordTo == len)
      return this.result(Penalty.ByWord + (byWordFolded ? Penalty.CaseFold : 0) + Penalty.NotStart, byWord, word)
    return chars.length == 2 ? null : this.result((any[0] ? Penalty.NotStart : 0) + Penalty.CaseFold + Penalty.Gap, any, word)
  }

  result(score: number, positions: number[], word: string) {
    let result = [score], i = 1
    for (let pos of positions) {
      let to = pos + (this.astral ? codePointSize(codePointAt(word, pos)) : 1)
      if (i > 1 && result[i - 1] == pos) result[i - 1] = to
      else { result[i++] = pos; result[i++] = to }
    }
    return result
  }
}
