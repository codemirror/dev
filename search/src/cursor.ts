import {Text, TextIterator} from "@codemirror/next/text"

const basicNormalize: (string: string) => string = typeof String.prototype.normalize == "function" ? x => x.normalize("NFKD") : x => x

/// A search cursor provides an iterator over text matches in a
/// document.
export class SearchCursor implements Iterator<{from: number, to: number}>{
  private iter: TextIterator
  /// The current match (only holds a meaningful value after
  /// [`next`](#search.SearchCursor.next) has been called and when
  /// `done` is false).
  value = {from: 0, to: 0}
  /// Whether the end of the iterated region has been reached.
  done = false
  private matches: number[] = []
  private buffer = ""
  private bufferPos = 0
  private bufferStart: number
  private normalize: (string: string) => string
  private query: string

  /// Create a text cursor. The query is the search string, `from` to
  /// `to` provides the region to search.
  ///
  /// When `normalize` is given, it will be called, on both the query
  /// string and the content it is matched against, before comparing.
  /// You can, for example, create a case-insensitive search by
  /// passing `s => s.toLowerCase()`.
  ///
  /// Text is always normalized with
  /// [`.normalize("NFKD")`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize)
  /// (when supported).
  constructor(text: Text, query: string,
              from: number = 0, to: number = text.length,
              normalize?: (string: string) => string) {
    this.iter = text.iterRange(from, to)
    this.bufferStart = from
    this.normalize = normalize ? x => normalize(basicNormalize(x)) : basicNormalize
    this.query = this.normalize(query)
  }

  private peek() {
    if (this.bufferPos == this.buffer.length) {
      this.bufferStart += this.buffer.length
      this.iter.next()
      if (this.iter.done) return -1
      this.bufferPos = 0
      this.buffer = this.iter.value
    }
    return this.buffer.charCodeAt(this.bufferPos)
  }

  /// Look for the next match. Updates the iterator's
  /// [`value`](#search.SearchCursor.value) and
  /// [`done`](#search.SearchCursor.done) properties. Should be called
  /// at least once before using the cursor.
  next() {
    for (;;) {
      let next = this.peek()
      if (next < 0) {
        this.done = true
        return this
      }
      let str = String.fromCharCode(next), start = this.bufferStart + this.bufferPos
      this.bufferPos++
      for (;;) {
        let peek = this.peek()
        if (peek < 0xDC00 || peek >= 0xE000) break
        this.bufferPos++
        str += String.fromCharCode(peek)
      }
      let norm = this.normalize(str)
      for (let i = 0, pos = start;; i++) {
        let code = norm.charCodeAt(i)
        let match = this.match(code, pos)
        if (match) {
          this.value = match!
          return this
        }
        if (i == norm.length - 1) break
        if (pos == start && i < str.length && str.charCodeAt(i) == code) pos++
      }
    }
  }

  private match(code: number, pos: number) {
    let match: null | {from: number, to: number} = null
    for (let i = 0; i < this.matches.length; i += 2) {
      let index = this.matches[i], keep = false
      if (this.query.charCodeAt(index) == code) {
        if (index == this.query.length - 1) {
          match = {from: this.matches[i + 1], to: pos + 1}
        } else {
          this.matches[i]++
          keep = true
        }
      }
      if (!keep) {
        this.matches.splice(i, 2)
        i -= 2
      }
    }
    if (this.query.charCodeAt(0) == code) {
      if (this.query.length == 1)
        match = {from: pos, to: pos + 1}
      else
        this.matches.push(1, pos)
    }
    return match
  }
}
