/* These were settled on through benchmarking */

// The max size of a leaf node
const MAX_LEAF = 512
// The base size of a leaf node
const BASE_LEAF = MAX_LEAF >> 1
// The desired amount of branches per node, as an exponent of 2 (so 3
// means 8 branches)
const TARGET_BRANCH_SHIFT = 3

export abstract class Rope {
  abstract readonly text: string;
  abstract readonly length: number;
  abstract slice(from: number, to: number): string;
  abstract replace(from: number, to: number, text: string): Rope;

  abstract decomposeStart(to: number, target: Rope[]): void;
  abstract decomposeEnd(from: number, target: Rope[]): void;

  protected constructor() {}

  static create(text: string): Rope {
    return text.length < MAX_LEAF ? new Leaf(text) : Node.from(text.length, Leaf.split(text, []))
  }
}

export class Leaf extends Rope {
  constructor(readonly text: string) {
    super()
  }

  get length(): number {
    return this.text.length
  }

  replace(from: number, to: number, text: string): Rope {
    text = this.text.slice(0, from) + text + this.text.slice(to)
    if (text.length <= MAX_LEAF) return new Leaf(text)
    return Node.from(text.length, Leaf.split(text, []))
  }

  decomposeStart(to: number, target: Rope[]) {
    target.push(new Leaf(this.text.slice(0, to)))
  }

  decomposeEnd(from: number, target: Rope[]) {
    target.push(new Leaf(this.text.slice(from)))
  }

  slice(from: number, to: number = this.text.length): string {
    return this.text.slice(from, to)
  }

  static split(text: string, target: Leaf[]): Leaf[] {
    for (let i = 0;; i += BASE_LEAF) {
      if (i + MAX_LEAF > text.length) {
        target.push(new Leaf(text.slice(i)))
        break
      }
      target.push(new Leaf(text.slice(i, i + BASE_LEAF)))
    }
    return target
  }
}

export class Node extends Rope {
  constructor(readonly length: number, readonly children: Rope[]) {
    super()
  }

  replace(from: number, to: number, text: string): Rope {
    let lengthDiff = text.length - (to - from), newLength = this.length + lengthDiff
    if (newLength <= BASE_LEAF) return new Leaf(this.slice(0, from) + text + this.slice(to))

    let children
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (from >= pos && to <= end &&
          (lengthDiff > 0
           ? child.length + lengthDiff < Math.max(newLength >> (TARGET_BRANCH_SHIFT - 1), MAX_LEAF)
           : child.length + lengthDiff > newLength >> TARGET_BRANCH_SHIFT)) {
        // Fast path: if the change only affects one child and the
        // child's size remains in the acceptable range, only update
        // that child
        children = this.children.slice()
        children[i] = child.replace(from - pos, to - pos, text)
        return new Node(newLength, children)
      } else if (end > from) {
        // Otherwise, we must build up a new array of children
        if (children == null) children = this.children.slice(0, i)
        if (pos < from) {
          if (end == from) children.push(child)
          else child.decomposeStart(from - pos, children)
          if (end >= to) Leaf.split(text, children)
        }
        if (pos >= to) children.push(child)
        else if (end > to) child.decomposeEnd(to - pos, children)
      }
      pos = end
    }
    return children ? Node.from(newLength, children) : this
  }

  decomposeStart(to: number, target: Rope[]) {
    for (let i = 0, pos = 0;; i++) {
      let child = this.children[i], end = pos + child.length
      if (end <= to) {
        target.push(child)
      } else {
        if (pos < to) child.decomposeStart(to - pos, target)
        break
      }
      pos = end
    }
  }

  decomposeEnd(from: number, target: Rope[]) {
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (pos >= from) target.push(child)
      else if (end > from && pos < from) child.decomposeEnd(from - pos, target)
      pos = end
    }
  }

  slice(from: number, to: number = this.length): string {
    let result = ""
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (to > pos && from < end)
        result += child.slice(Math.max(0, from - pos), Math.min(child.length, to - pos))
      pos = end
    }
    return result
  }

  get text(): string {
    let result = ""
    for (let i = 0; i < this.children.length; i++)
      result += this.children[i].text
    return result
  }

  static from(length: number, children: Rope[]): Rope {
    if (children.length == 0) return new Leaf("")

    let chunkLength = length >> TARGET_BRANCH_SHIFT, maxLength = chunkLength << 1, minLength = chunkLength >> 1
    let chunked: Rope[] = [], currentLength = 0, currentChunk: Rope[] = []
    function add(child: Rope) {
      let childLength = child.length, last
      if (childLength > maxLength && child instanceof Node) {
        for (let i = 0; i < child.children.length; i++) add(child.children[i])
      } else if (childLength > minLength && (currentLength > minLength || currentLength == 0)) {
        flush()
        chunked.push(child)
      } else if (child instanceof Leaf && currentLength > 0 &&
                 (last = currentChunk[currentChunk.length - 1]) instanceof Leaf &&
                 child.length + last.length <= BASE_LEAF) {
        currentLength += childLength
        currentChunk[currentChunk.length - 1] = new Leaf(last.text + child.text)
      } else {
        if (currentLength + childLength > chunkLength) flush()
        currentLength += childLength
        currentChunk.push(child)
      }
    }
    function flush() {
      if (currentLength > 0) {
        chunked.push(currentChunk.length == 1 ? currentChunk[0] : Node.from(currentLength, currentChunk))
        currentLength = 0
        currentChunk.length = 0
      }
    }

    for (let i = 0; i < children.length; i++) add(children[i])
    flush()
    return chunked.length == 1 ? chunked[0] : new Node(length, chunked)
  }
}
