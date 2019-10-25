import {Text, TextIterator, isExtendingChar} from "../../text"

const basicNormalize: (string: string) => string = String.prototype.normalize ? x => x.normalize("NFKD") : x => x

export class SearchCursor {
  private iter: TextIterator
  value = {from: 0, to: 0}
  done = false
  private matches: number[] = []
  private buffer = ""
  private bufferPos = 0
  private bufferStart: number
  private normalize: (string: string) => string
  private query: string

  constructor(readonly text: Text, query: string,
              from: number = 0, to: number = text.length,
              normalize?: (string: string) => string) {
    this.iter = text.iterRange(from, to)
    this.bufferStart = from
    this.normalize = normalize ? x => normalize(basicNormalize(x)) : basicNormalize
    this.query = this.normalize(query)
  }

  peek() {
    if (this.bufferPos == this.buffer.length) {
      this.bufferStart += this.buffer.length
      this.iter.next()
      if (this.iter.done) return -1
      this.bufferPos = 0
      this.buffer = this.iter.value
    }
    return this.buffer.charCodeAt(this.bufferPos)
  }

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
        if (peek < 0 || !isExtendingChar(peek)) break
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

  match(code: number, pos: number) {
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
