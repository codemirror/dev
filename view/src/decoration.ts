import {Change} from "../../state/src/state"

interface DecorationSpec {
  startAssoc?: number;
  endAssoc?: number;
  assoc?: number;
  attributes?: {[key: string]: string};
  lineAttributes?: {[key: string]: string};
  tagName?: string;
}

class DecorationDesc {
  startAssoc: number;
  endAssoc: number;

  constructor(public spec: DecorationSpec) {
    this.startAssoc = spec.startAssoc != null ? spec.startAssoc : spec.assoc != null ? spec.assoc : 1
    this.endAssoc = spec.endAssoc != null ? spec.endAssoc : spec.assoc != null ? spec.assoc : -1
  }
}

export class Decoration {
  constructor(public readonly from: number,
              public readonly to: number,
              /** internal */ public readonly desc: DecorationDesc) {}

  get spec() { return this.desc.spec }

  map(change: Change): Decoration {
    let from = change.mapPos(this.from, this.desc.startAssoc)
    let to = this.from == this.to ? from : change.mapPos(this.to, this.desc.endAssoc)
    return new Decoration(from, to, this.desc)
  }

  move(offset: number): Decoration {
    return new Decoration(this.from + offset, this.to + offset, this.desc)
  }
}

const noDecorations: ReadonlyArray<Decoration> = []
const noChildren: ReadonlyArray<DecorationSet> = noDecorations as any as ReadonlyArray<DecorationSet>

const BASE_NODE_SIZE_SHIFT = 4, BASE_NODE_SIZE = 1 << BASE_NODE_SIZE_SHIFT

export class DecorationSet {
  private constructor(public length: number,
                      public size: number,
                      public local: ReadonlyArray<Decoration>,
                      public children: ReadonlyArray<DecorationSet>) {}

  static create(decorations: Decoration[]): DecorationSet {
    return DecorationSet.empty.update(decorations)
  }

  update(decorations: ReadonlyArray<Decoration> = noDecorations,
         filter: ((decoration: Decoration) => boolean) | null = null): DecorationSet {
    return this.updateInner(decorations.length ? decorations.slice().sort(byPos) : decorations, filter, 0)
  }

  private updateInner(decorations: ReadonlyArray<Decoration>,
                      filter: ((decoration: Decoration) => boolean) | null, offset: number): DecorationSet {
    let local: Decoration[] = filterDecorations(this.local, filter) as Decoration[]
    let localSortedLength = local.length

    let children: DecorationSet[] | null = null
    let size = 0, length = this.length, startPos = offset + length
    let decI = 0, pos = offset
    for (let i = 0; i < this.children.length; i++) {
      let child = this.children[i], endPos = pos + child.length, localDeco: Decoration[] | null = null
      while (decI < decorations.length) {
        let next = decorations[decI]
        if (next.from >= endPos) break
        decI++
        if (next.to > endPos) {
          if (local == this.local) local = local.slice()
          local.push(next.move(-offset))
          length = Math.max(length, next.to - offset)
        } else {
          if (localDeco == null) localDeco = []
          localDeco.push(next)
        }
      }
      let newChild = filter || localDeco ? child.updateInner(localDeco || noDecorations, filter, pos) : child
      size += newChild.size
      if (newChild != child) {
        if (!children) children = this.children.slice(0, i)
        children.push(newChild)
      } else if (children) {
        children.push(newChild)
      }
      pos = endPos
    }

    if (local == this.local && !children && decI == decorations.length) return this

    size += local.length + decorations.length - decI
    for (let i = decI; i < decorations.length; i++) length = Math.max(length, decorations[i].to)
    let childSize = Math.max(BASE_NODE_SIZE, size >> BASE_NODE_SIZE_SHIFT)

    while (decI < decorations.length) {
      let add: Decoration[] = []
      let end = decI + (childSize << 1) >= decorations.length ? decorations.length : decI + childSize
      let endPos = offset + (end == decorations.length ? length : decorations[end].from)
      for (let add = []; decI < end;) {
        let deco = decorations[decI++]
        if (deco.to > endPos) {
          if (local == this.local) local = local.slice()
          local.push(deco.move(-offset))
        } else {
          add.push(deco)
        }
      }
      if (add.length) {
        if (!children) children = this.children.slice()
        children.push(DecorationSet.createChild(add, endPos - startPos, startPos))
        startPos = endPos
      }
    }

    // FIXME split/balance/join

    if (local.length > localSortedLength) local.sort(byPos)
    return new DecorationSet(length, size, local, children || this.children)
  }

  static createChild(decorations: Decoration[], size: number, offset: number): DecorationSet {
    let set = DecorationSet.empty.updateInner(decorations, null, offset)
    set.size = size
    return set
  }

  static empty = new DecorationSet(0, 0, noDecorations, noChildren);
}

function byPos(a: Decoration, b: Decoration): number {
  return (a.from - b.from) || (a.to - b.to) || (a.desc.startAssoc - b.desc.startAssoc)
}

function filterDecorations(decorations: ReadonlyArray<Decoration>, filter: ((decoration: Decoration) => boolean) | null): ReadonlyArray<Decoration> {
  if (filter == null) return decorations
  let copy: Decoration[] | null = null
  for (let i = 0; i < decorations.length; i++) {
    let deco = decorations[i]
    if (filter(deco)) {
      if (copy != null) copy.push(deco)
    } else {
      if (copy == null) copy = decorations.slice(0, i)
    }
  }
  return copy || decorations
}
