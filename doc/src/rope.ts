const MAX_LEAF = 256
const BASE_LEAF = 128
const TARGET_BRANCH_SHIFT = 4

export abstract class Rope {
  abstract text: string;
  abstract length: number;
  abstract slice(from: number, to: number): string;
  abstract insert(text: string, at: number): Rope;
  abstract insertInner(text: string, at: number): Rope[];
  abstract delete(from: number, to: number): Rope;

  static create(text: string): Rope {
    return text.length < MAX_LEAF ? new Leaf(text) : Node.from(text.length, Leaf.split(text))
  }
}

export class Leaf extends Rope {
  text: string;

  constructor(text: string) {
    super()
    this.text = text
  }

  get length(): number {
    return this.text.length
  }

  insert(text: string, at: number): Rope {
    text = this.text.slice(0, at) + text + this.text.slice(at)
    if (text.length <= MAX_LEAF) return new Leaf(text)
    return Node.from(text.length, Leaf.split(text))
  }

  static split(text: string): Leaf[] {
    let leaves: Leaf[] = []
    for (let i = 0;; i += BASE_LEAF) {
      if (i + MAX_LEAF > text.length) {
        leaves.push(new Leaf(text.slice(i)))
        break
      }
      leaves.push(new Leaf(text.slice(i, i + BASE_LEAF)))
    }
    return leaves
  }

  insertInner(text: string, at: number): Rope[] {
    return Leaf.split(this.text.slice(0, at) + text + this.text.slice(at))
  }

  delete(from: number, to: number = this.length): Leaf {
    return new Leaf(this.text.slice(0, from) + this.text.slice(to))
  }

  slice(from: number, to: number = this.text.length): string {
    return this.text.slice(from, to)
  }
}

export class Node extends Rope {
  length: number;
  children: Rope[];

  constructor(length: number, children: Rope[]) {
    super()
    this.length = length
    this.children = children
  }

  insert(text: string, at: number): Rope {
    let child, childN
    for (let i = 0, pos = 0;; i++) {
      child = this.children[i]
      let end = pos + child.length
      if (at <= end) { childN = i; at -= pos; break }
      pos = end
    }
    let totalLength = this.length + text.length, maxChunk = totalLength >> (TARGET_BRANCH_SHIFT - 1)
    if (child.length + text.length < Math.max(MAX_LEAF, maxChunk)) { // Fast path — insert into single child
      let children = this.children.slice()
      children[childN] = child.insert(text, at)
      return new Node(totalLength, children)
    } else { // Build up a node list first, then balance into a tree
      return Node.from(totalLength, this.children.slice(0, childN)
                       .concat(child.insertInner(text, at))
                       .concat(this.children.slice(childN + 1)))
    }
  }

  insertInner(text: string, at: number): Rope[] {
    let child, childN
    for (let i = 0, pos = 0;; i++) {
      child = this.children[i]
      let end = pos + child.length
      if (at <= end) { childN = i; at -= pos; break }
      pos = end
    }
    return this.children.slice(0, childN)
      .concat(child.insertInner(text, at))
      .concat(this.children.slice(childN + 1))
  }

  delete(from: number, to: number = this.length): Rope {
    let newLength = this.length - (to - from)
    if (newLength <= BASE_LEAF) return new Leaf(this.slice(0, from) + this.slice(to))

    let children = [], cutAt = -1
    for (let i = 0, pos = 0; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (from >= end || to <= pos)
        children.push(child)
      else if (pos < from || end > to)
        children.push(child.delete(Math.max(0, from - pos), Math.min(child.length, to - pos)))
      pos = end
    }
    return new Node(newLength, children)
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
      let childLength = child.length
      if (childLength > maxLength && child instanceof Node) {
        for (let i = 0; i < child.children.length; i++) add(child.children[i])
      } else if (childLength > minLength && (currentLength > minLength || currentLength == 0)) {
        flush()
        chunked.push(child)
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
