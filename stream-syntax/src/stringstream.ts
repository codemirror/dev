import {Text, TextIterator} from "../../doc/src"

// Counts the column offset in a string, taking tabs into account.
// Used mostly to find indentation.
// FIXME more or less duplicated in indent/src/indent.ts
function countColumn(string: string, end: number | null, tabSize: number, startIndex?: number, startValue?: number): number {
  if (end == null) {
    end = string.search(/[^\s\u00a0]/)
    if (end == -1) end = string.length
  }
  for (let i = startIndex || 0, n = startValue || 0;;) {
    let nextTab = string.indexOf("\t", i)
    if (nextTab < 0 || nextTab >= end)
      return n + (end - i)
    n += nextTab - i
    n += tabSize - (n % tabSize)
    i = nextTab + 1
  }
}

// STRING STREAM

// Fed to the mode parsers, provides helper functions to make
// parsers more succinct.

export class StringStream {
  pos: number
  start: number
  lineStart: number
  lastColumnPos: number
  lastColumnValue: number

  constructor(public string: string, public tabSize: number, private lineOracle: any) {
    this.pos = this.start = 0
    this.string = string
    this.tabSize = tabSize || 8
    this.lastColumnPos = this.lastColumnValue = 0
    this.lineStart = 0
    this.lineOracle = lineOracle
  }

  eol(): boolean {return this.pos >= this.string.length}
  sol(): boolean {return this.pos == this.lineStart}
  peek() {return this.string.charAt(this.pos) || undefined}
  next(): string | void {
    if (this.pos < this.string.length)
      return this.string.charAt(this.pos++)
  }
  eat(match: string | RegExp | ((ch: string) => boolean)): string | void {
    let ch = this.string.charAt(this.pos)
    let ok
    if (typeof match == "string") ok = ch == match
    else ok = ch && (match instanceof RegExp ? match.test(ch) : match(ch))
    if (ok) {++this.pos; return ch}
  }
  eatWhile(match: string | RegExp | ((ch: string) => boolean)): boolean {
    let start = this.pos
    while (this.eat(match)){}
    return this.pos > start
  }
  eatSpace() {
    let start = this.pos
    while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos
    return this.pos > start
  }
  skipToEnd() {this.pos = this.string.length}
  skipTo(ch: string): boolean | void {
    let found = this.string.indexOf(ch, this.pos)
    if (found > -1) {this.pos = found; return true}
  }
  backUp(n: number) {this.pos -= n}
  column() {
    if (this.lastColumnPos < this.start) {
      this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue)
      this.lastColumnPos = this.start
    }
    return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0)
  }
  indentation() {
    return countColumn(this.string, null, this.tabSize) -
      (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0)
  }
  match(pattern: string | RegExp, consume?: boolean, caseInsensitive?: boolean): boolean | RegExpMatchArray | null {
    if (typeof pattern == "string") {
      let cased = (str: string) => caseInsensitive ? str.toLowerCase() : str
      let substr = this.string.substr(this.pos, pattern.length)
      if (cased(substr) == cased(pattern)) {
        if (consume !== false) this.pos += pattern.length
        return true
      } else return null
    } else {
      let match = this.string.slice(this.pos).match(pattern)
      if (match && match.index! > 0) return null
      if (match && consume !== false) this.pos += match[0].length
      return match
    }
  }
  current(){return this.string.slice(this.start, this.pos)}
  hideFirstChars(n: number, inner: () => void) {
    this.lineStart += n
    try { return inner() }
    finally { this.lineStart -= n }
  }
  lookAhead(n: number): string {
    let oracle = this.lineOracle
    return oracle && oracle.lookAhead(n)
  }
  baseToken() {
    let oracle = this.lineOracle
    return oracle && oracle.baseToken(this.pos)
  }
}

export class StringStreamCursor {
  private curLineEnd: number
  private readonly iter: TextIterator

  constructor(text: Text, public offset: number, readonly tabSize: number = 4) {
    this.iter = text.iterLines(offset)
    this.curLineEnd = this.offset - 1
  }

  next() {
    let {value, done} = this.iter.next()
    if (done) throw new RangeError("Reached end of document")
    const res = new StringStream(value, this.tabSize, null)
    this.offset = this.curLineEnd + 1
    this.curLineEnd += value.length + 1
    return res
  }
}
