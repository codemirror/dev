import {LineCursor, TextCursor} from "../../doc/src/text"
import {StringStream} from "./stringstream"

export class StringStreamCursor {
  private curLineEnd: number
  private readonly iter: LineCursor

  constructor(iter: TextCursor, public offset: number) {
    this.iter = new LineCursor(iter)
    this.curLineEnd = this.offset - 1
  }

  next() {
    const chunk = this.iter.next()
    const res = new StringStream(chunk)
    this.offset = this.curLineEnd + 1
    this.curLineEnd += chunk.length + 1
    return res
  }
}
