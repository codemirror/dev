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
  private constructor(
    public readonly from: number,
    public readonly to: number,
    /** internal */
    public readonly desc: DecorationDesc
  ) {}

  get spec() { return this.desc.spec }

  map(change: Change): Decoration {
    let from = change.mapPos(this.from, this.desc.startAssoc)
    let to = this.from == this.to ? from : change.mapPos(this.to, this.desc.endAssoc)
    return new Decoration(from, to, this.desc)
  }

  move(offset: number): Decoration {
    return offset ? new Decoration(this.from + offset, this.to + offset, this.desc) : this
  }

  static create(from: number, to: number, spec: DecorationSpec): Decoration {
    return new Decoration(from, to, new DecorationDesc(spec))
  }
}

const noDecorations: ReadonlyArray<Decoration> = []
const noChildren: ReadonlyArray<DecorationSet> = noDecorations as any as ReadonlyArray<DecorationSet>

const BASE_NODE_SIZE_SHIFT = 5, BASE_NODE_SIZE = 1 << BASE_NODE_SIZE_SHIFT

type DecorationFilter = (from: number, to: number, spec: DecorationSpec) => boolean

export class DecorationSet {
  private constructor(
    // The text length covered by this set
    private length: number,
    // The number of decorations in the set
    public size: number,
    // The locally stored decorations—which are all of them for leaf
    // nodes, and the ones that don't fit in child sets for
    // non-leaves. Sorted via byPos
    private local: ReadonlyArray<Decoration>,
    // The child sets, in position order
    private children: ReadonlyArray<DecorationSet>
  ) {}

  update(decorations: ReadonlyArray<Decoration> = noDecorations, filter: DecorationFilter | null = null): DecorationSet {
    return this.updateInner(decorations.length ? decorations.slice().sort(byPos) : decorations, filter, 0)
  }

  private updateInner(decorations: ReadonlyArray<Decoration>, filter: DecorationFilter | null, offset: number): DecorationSet {
    // The new local decorations. May equal this.local at any point in
    // this method, in which case it has to be copied before mutation
    let local: Decoration[] = filterDecorations(this.local, filter, offset) as Decoration[]
    // The new array of child sets. May equal this.children as long as
    // no changes are made
    let children: DecorationSet[] = this.children as DecorationSet[]

    let size = 0, length = this.length
    let decI = 0, pos = offset
    // First iterate over the child sets, applying filters and pushing
    // added decorations into them
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
      let copied = children != this.children
      if (newChild != child) {
        if (!copied) children = this.children.slice(0, i)
        children.push(newChild)
      } else if (copied) {
        children.push(newChild)
      }
      pos = endPos
    }

    // If nothing was actually updated, return the existing object
    if (local == this.local && children == this.children && decI == decorations.length) return this

    size += local.length + decorations.length - decI
    for (let i = decI; i < decorations.length; i++) length = Math.max(length, decorations[i].to - offset)
    let childSize = Math.max(BASE_NODE_SIZE, size >> BASE_NODE_SIZE_SHIFT)

    // This is a small node—turn it into a flat leaf
    if (size <= BASE_NODE_SIZE) {
      for (let i = 0, off = 0; i < children.length; i++) {
        let child = children[i]
        if (local == this.local) local = local.slice()
        child.collect(local, -off)
        off += child.length
      }
      children = noChildren as DecorationSet[]
      while (decI < decorations.length) {
        if (local == this.local) local = local.slice()
        local.push(decorations[decI++].move(-offset))
      }
    }

    // Group added decorations after the current children into new
    // children (will usually only happen when initially creating a
    // node or adding stuff to the top-level node)
    while (decI < decorations.length) {
      let add: Decoration[] = []
      let end = Math.min(decI + childSize, decorations.length)
      let endPos = end == decorations.length ? offset + length : decorations[end].from
      for (; decI < end; decI++) {
        let deco = decorations[decI]
        if (deco.to > endPos) {
          if (local == this.local) local = local.slice()
          local.push(deco.move(-offset))
        } else {
          add.push(deco)
        }
      }
      if (add.length) {
        if (children == this.children) children = this.children.slice()
        children.push(DecorationSet.createChild(add, endPos - pos, pos))
        pos = endPos
      }
    }

    // Rebalance the children if necessary
    if (children != this.children) {
      for (let i = 0, off = 0; i < children.length;) {
        let child = children[i], next
        if (child.size == 0 && (i > 0 || children.length == 1)) {
          // Drop empty node
          children.splice(i--, 1)
          if (i >= 0) children[i] = children[i].grow(child.length)
        } else if (child.size > (childSize << 1) && child.local.length < (child.length >> 1)) {
          // Unwrap an overly big node
          for (let j = 0; j < child.local.length; j++) {
            if (local == this.local) local = this.local.slice()
            local.push(child.local[j].move(off))
          }
          children.splice(i, 1, ...child.children)
        } else if (child.children.length == 0 && i < children.length - 1 &&
                   (next = children[i + 1]).size + child.size <= BASE_NODE_SIZE &&
                   next.children.length == 0) {
          // Join two small leaf nodes
          children.splice(i, 2, new DecorationSet(child.length + next.length,
                                                  child.size + next.size,
                                                  child.local.concat(next.local.map(d => d.move(child.length))),
                                                  noChildren))
          off += child.length + next.length
        } else {
          // Join a number of nodes into a wrapper node
          let joinTo = i + 1, size = child.size, length = child.length
          if (child.size < (childSize >> 1)) {
            for (; joinTo < children.length; joinTo++) {
              let next = children[joinTo], totalSize = size + next.size
              if (totalSize > childSize) break
              size = totalSize
              length += next.length
            }
          }
          if (joinTo > i + 1) {
            let joined = new DecorationSet(length, size, noDecorations, children.slice(i, joinTo))
            let joinedLocals = []
            for (let j = 0; j < local.length; j++) {
              let deco = local[j]
              if (deco.from >= off && deco.to <= off + length) {
                if (local == this.local) local = this.local.slice()
                local.splice(j--, 1)
                joinedLocals.push(deco.move(-off))
              }
            }
            if (joinedLocals.length) joined = joined.update(joinedLocals.sort(byPos))
            children.splice(i, joinTo - i, joined)
            i = joinTo
            off += length
          } else {
            i++
            off += child.length
          }
        }
      }
    }

    return new DecorationSet(length, size, local == this.local ? local : local.sort(byPos), children)
  }

  grow(length: number): DecorationSet {
    return new DecorationSet(this.length + length, this.size, this.local, this.children)
  }

  // Collect all decorations in this set into the target array,
  // offsetting them by `offset`
  collect(target: Decoration[], offset: number) {
    for (let i = 0; i < this.local.length; i++)
      target.push(this.local[i].move(offset))
    for (let i = 0; i < this.children.length; i++) {
      let child = this.children[i]
      child.collect(target, offset)
      offset += child.length
    }
  }

  static createChild(decorations: Decoration[], length: number, offset: number): DecorationSet {
    let set = DecorationSet.empty.updateInner(decorations, null, offset)
    set.length = length
    return set
  }

  static create(decorations: Decoration[]): DecorationSet {
    return DecorationSet.empty.update(decorations)
  }

  static empty = new DecorationSet(0, 0, noDecorations, noChildren);
}

function byPos(a: Decoration, b: Decoration): number {
  return (a.from - b.from) || (a.to - b.to) || (a.desc.startAssoc - b.desc.startAssoc)
}

function filterDecorations(decorations: ReadonlyArray<Decoration>, filter: DecorationFilter | null, offset: number): ReadonlyArray<Decoration> {
  if (!filter) return decorations
  let copy: Decoration[] | null = null
  for (let i = 0; i < decorations.length; i++) {
    let deco = decorations[i]
    if (filter(deco.from + offset, deco.to + offset, deco.spec)) {
      if (copy != null) copy.push(deco)
    } else {
      if (copy == null) copy = decorations.slice(0, i)
    }
  }
  return copy || decorations
}
