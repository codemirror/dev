import {Rect} from "./dom"

declare global {
  interface Node { cmView: ContentView | undefined; cmIgnore: boolean | undefined }
}

export const enum dirty { not = 0, child = 1, node = 2 }

const none: any[] = []

export abstract class ContentView {
  constructor(public parent: ContentView | null, public dom: Node | null) {
    if (dom) dom.cmView = this
  }

  abstract length: number;
  abstract children: ContentView[];
  dirty: number = dirty.not;

  get childGap() { return 0 }
  get overrideDOMText(): ReadonlyArray<string> | null { return null }

  get posAtStart(): number {
    return this.parent ? this.parent.posBefore(this) : 0
  }

  get posAtEnd(): number {
    return this.posAtStart + this.length
  }

  posBefore(view: ContentView): number {
    let pos = this.posAtStart
    for (let child of this.children) {
      if (child == view) return pos
      pos += child.length + this.childGap
    }
    throw new RangeError("Invalid child in posBefore")
  }

  posAfter(view: ContentView): number {
    return this.posBefore(view) + view.length
  }

  coordsAt(pos: number): Rect | null {
    for (let off = 0, i = 0; i < this.children.length; i++) {
      let child = this.children[i], end = off + child.length
      if (end >= pos && (end != off || this.childGap)) return child.coordsAt(pos - off)
      off = end + this.childGap
    }
    return null
  }

  syncDOMChildren() {
    if (!this.dom) return
    let dom = this.dom.firstChild
    for (let view of this.children) {
      let childDOM = view.dom
      if (!childDOM) continue
      if (childDOM.parentNode == this.dom) {
        while (childDOM != dom) dom = rm(dom!)
        dom = dom.nextSibling
      } else {
        this.dom.insertBefore(childDOM, dom)
      }
    }
    while (dom) dom = rm(dom)
  }

  sync() {
    if (this.dirty & dirty.node)
      this.syncDOMChildren()
    if (this.dirty & dirty.child)
      for (let child of this.children) if (child.dirty) child.sync()
    this.dirty = dirty.not
  }

  domFromPos(pos: number): {node: Node, offset: number} | null { return null }

  localPosFromDOM(node: Node, offset: number): number {
    let after: Node | null
    if (node == this.dom) {
      after = this.dom.childNodes[offset]
    } else {
      let bias = !node.firstChild ? 0 : offset == 0 ? -1 : 1
      for (;;) {
        let parent = node.parentNode!
        if (parent == this.dom) break
        if (bias == 0 && parent.firstChild != parent.lastChild) {
          if (node == parent.firstChild) bias = -1
          else bias = 1
        }
        node = parent
      }
      if (bias < 0) after = node
      else after = node.nextSibling
    }
    while (after && !after.cmView) after = after.nextSibling
    if (!after) return this.length

    for (let i = 0, pos = 0;; i++) {
      let child = this.children[i]
      if (child.dom == after) return pos
      pos += child.length + this.childGap
    }
  }

  domBoundsAround(from: number, to: number, offset = 0): {startDOM: Node | null, endDOM: Node | null, from: number, to: number} | null {
    let fromI = -1, fromStart = -1, toI = -1, toEnd = -1
    for (let i = 0, pos = offset; i < this.children.length; i++) {
      let child = this.children[i], end = pos + child.length
      if (pos < from && end > to) return child.domBoundsAround(from, to, pos)
      if (end >= from && fromI == -1) { fromI = i; fromStart = pos }
      if (end >= to && toI == -1) { toI = i; toEnd = end; break }
      pos = end + this.childGap
    }
    return {from: fromStart, to: toEnd,
            startDOM: (fromI ? this.children[fromI - 1].dom!.nextSibling : null) || this.dom!.firstChild,
            endDOM: toI < this.children.length - 1 ? this.children[toI + 1].dom : null}
  }

  // FIXME track precise dirty ranges, to avoid full DOM sync on every touched node?
  markDirty() {
    if (this.dirty & dirty.node) return
    this.dirty |= dirty.node
    this.markParentsDirty()
  }

  markParentsDirty() {
    for (let parent = this.parent; parent; parent = parent.parent) {
      if (parent.dirty & dirty.child) return
      parent.dirty |= dirty.child
    }
  }

  setParent(parent: ContentView) {
    this.parent = parent
    if (this.dirty) this.markParentsDirty()
  }

  replaceChildren(from: number, to: number, children: ContentView[] = none) {
    this.children.splice(from, to - from, ...children)
    this.markDirty()
  }

  ignoreMutation(rec: MutationRecord): boolean { return false }
  ignoreEvent(event: Event): boolean { return false }
}

// Remove a DOM node and return its next sibling.
function rm(dom: Node): Node {
  let next = dom.nextSibling
  dom.parentNode!.removeChild(dom)
  return next!
}

export class ChildCursor {
  off: number = 0

  constructor(public children: ContentView[], public pos: number,
              public gap: number = 0, public i: number = children.length) {
    this.pos += gap
  }

  findPos(pos: number, bias: number = 1): this {
    for (;;) {
      if (pos > this.pos || pos == this.pos && (bias > 0 || this.i == 0)) {
        this.off = pos - this.pos
        return this
      }
      this.pos -= this.children[--this.i].length + this.gap
    }
  }
}
