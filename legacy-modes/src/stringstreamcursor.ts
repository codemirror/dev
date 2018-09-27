import {Text, TextIterator} from "../../doc/src"
import {StringStream} from "./stringstream"

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
