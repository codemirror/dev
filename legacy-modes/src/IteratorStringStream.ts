import {LineCursor, Text} from "../../doc/src/text"
import StringStream from "./StringStream"

export class IteratorStringStream extends StringStream {
  private curLineEnd = -1
  public offset
  private iter

  constructor(private readonly text: Text) {
    this.iter = new LineCursor(text.iter())
    super(this.nextChunk())
  }

  eof() { return this.offset >= this.text.length }
  nextLine() { StringStream.call(this, this.nextChunk()) }

  private nextChunk(): string {
    this.offset = this.curLineEnd + 1
    const chunk = this.iter.next()
    this.curLineEnd += chunk.length + 1
    return chunk
  }
}
