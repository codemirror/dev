export class TruncatingStack<E> {
  static empty<E>(maxLen: number): TruncatingStack<E> {
    // Find segmentSize and segmentCount so that
    // a) segmentCount * segmentSize - segmentSize >= maxLen
    // b) segmentSize >= segmentCount
    // Also makes segmentSize a power of two
    let segmentSize = Math.pow(2, Math.ceil(Math.log2(maxLen) / 2))
    let segmentCount = maxLen / segmentSize + 1
    while (segmentSize < segmentCount) {
      segmentSize *= 2
      segmentCount = maxLen / segmentSize + 1
    }
    segmentCount = Math.ceil(segmentCount)
    return new TruncatingStack(segmentCount, segmentSize)
  }

  private constructor(private readonly segmentCount: number,
              private readonly segmentSize: number,
              private readonly entries: ReadonlyArray<ReadonlyArray<E>> = []) {}

  private splitSegment(segment: ReadonlyArray<E>): E[][] {
    let result = []
    let idx = Math.max(0, segment.length - this.segmentSize * this.segmentCount)
    while (segment.length - idx > this.segmentSize) {
      result.push(segment.slice(idx, idx += this.segmentSize))
    }
    result.push(segment.slice(idx))
    return result
  }

  replaceFrom(from: number, newItems: ReadonlyArray<E> = []): TruncatingStack<E> {
    let lastSegmentIdx = this.entries.length - 1
    let lastSegment = this.entries[lastSegmentIdx]
    const len = lastSegment ? (this.entries.length - 1) * this.segmentSize + lastSegment.length : 0
    from = from - len
    while (from > lastSegment.length) {
      from -= lastSegment.length
      lastSegment = this.entries[--lastSegmentIdx]
    }
    const newSegments = this.splitSegment(lastSegment.slice(0, from).concat(newItems))
    return new TruncatingStack(this.segmentCount, this.segmentSize,
                               this.entries.slice(newSegments.length + this.entries.length - 1 - this.segmentCount, lastSegmentIdx).concat(newSegments))
  }

  replaceBefore(to: number, newItems: ReadonlyArray<E> = []): TruncatingStack<E> {
    let newEntries
    if (to == newItems.length) {
      newEntries = this.splitSegment(newItems)
      newEntries.splice(-1, 1, newEntries[newEntries.length - 1].concat(this.entries[newEntries.length - 1].slice(newEntries[newEntries.length - 1].length)), ...this.entries.slice(newEntries.length))
    } else {
      let firstSegmentIdx = 0
      let firstSegment = this.entries[firstSegmentIdx]
      while (to > firstSegment.length) {
        to -= firstSegment.length
        firstSegment = this.entries[++firstSegmentIdx]
      }
      newEntries = this.splitSegment(newItems.concat(firstSegment.slice(to), ...this.entries.slice(firstSegmentIdx + 1)))
    }
    return new TruncatingStack(this.segmentCount, this.segmentSize, newEntries)
  }

  push(newItem: E): TruncatingStack<E> {
    const lastSegment = this.entries[this.entries.length - 1] || []
    let entries = this.entries
    if (lastSegment.length == this.segmentSize) {
      if (this.entries.length == this.segmentCount) entries = entries.slice(1)
      entries = entries.concat([[newItem]])
    } else {
      entries = entries.slice(0, -1).concat([lastSegment.concat([newItem])])
    }
    return new TruncatingStack(this.segmentCount, this.segmentSize, entries)
  }

  get lastItem(): E | null {
    const lastSegment = this.entries[this.entries.length - 1]
    return lastSegment && lastSegment[lastSegment.length - 1]
  }

  get length(): number {
    const lastSegment = this.entries[this.entries.length - 1]
    return lastSegment ? (this.entries.length - 1) * this.segmentSize + lastSegment.length : 0
  }

  get(n: number): E | null {
    const segment = Math.floor(n / this.segmentSize)
    return this.entries[segment] && this.entries[segment][n % this.segmentSize]
  }
}
