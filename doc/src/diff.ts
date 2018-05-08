import {Text} from "./text"

export interface ChangedRange { fromA: number, fromB: number, toA: number, toB: number }

class DiffState {
  ranges: ChangedRange[] = [];
  constructor(public a: Text, public b: Text) {}
}

// Find the approximate difference between two Text instances, which
// are expected (but not required) to share structure by exploiting
// quick node comparisons at different levels. If that doesn't work,
// this errs on the side of returning too big a range, rather than
// computing an accutate diff on a huge range of characters, which can
// get expensive.
export function changedRanges(a: Text, b: Text): ChangedRange[] {
  if (a == b) return []

  let state = new DiffState(a, b)

  for (let pos = 0;;) {
    let chA = a.children, chB = b.children
    if (chA == null || chB == null) {
      if (chA || chB) {
        scanText(state, pos, pos + a.length, pos, pos + b.length)
      } else { // Both are text nodes, directly compare content
        let diff = computeDiff(a.text, b.text)
        for (let i = 0; i < diff.length; i++) {
          let range = diff[i]
          state.ranges.push({fromA: range.fromA + pos, toA: range.toA + pos,
                             fromB: range.fromB + pos, toB: range.toB + pos})
        }
      }
      break
    }

    let start = 0, endA = chA.length, endB = chB.length, skipOff = 0
    while (start < endA && start < endB && chA[start] == chB[start]) skipOff += chA[start++].length
    let startPos = pos + skipOff
    while (endA > start && endB > start && chA[endA - 1] == chB[endB - 1]) {
      endA--, endB--
      skipOff += chA[endA].length
    }
    if (endA == endB && endA == start + 1) { // Single child changed
      a = chA[start]
      b = chB[start]
      pos = startPos
    } else {
      let leftA = a.length - skipOff, leftB = b.length - skipOff
      if (leftA == 0 || leftB == 0)
        state.ranges.push({fromA: startPos, toA: startPos, fromB: startPos + leftA, toB: startPos + leftB})
      else
        scanNodes(state, startPos, leftA, chA.slice(start, endA),
                  startPos, leftB, chB.slice(start, endB))
      break
    }
  }

  return state.ranges
}

const MAX_FULL_TEXT_DIFF_SIZE = 256

function scanText(state: DiffState, fromA: number, toA: number, fromB: number, toB: number) {
  for (let iA = state.a.iterRange(fromA, toA), iB = state.b.iterRange(fromB, toB),
           vA = iA.next(), vB = iB.next(),
           offA = 0, offB = 0; fromA < toA && fromB < toB;) {
    if (offA == vA.length) { offA = 0; vA = iA.next() }
    if (offB == vB.length) { offB = 0; vB = iB.next() }
    if (vA.charCodeAt(offA) != vB.charCodeAt(offB)) break
    fromA++; fromB++; offA++; offB++
  }
  if (fromA == toA || fromB == toB) {
    if (fromA < toA || fromB < toB) state.ranges.push({fromA, toA, fromB, toB})
    return
  }
  for (let iA = state.a.iterRange(toA, fromA), iB = state.b.iterRange(toB, fromB),
           vA = iA.next(), vB = iB.next(),
           offA = vA.length, offB = vB.length; toA > fromA && toB > fromB;) {
    if (offA == 0) { vA = iA.next(); offA = vA.length }
    if (offB == 0) { vB = iB.next(); offB = vB.length }
    if (vA.charCodeAt(offA - 1) != vB.charCodeAt(offB - 1)) break
    toA--; toB--; offA--; offB--
  }
  if (Math.max(toA - fromA, toB - fromB) <= MAX_FULL_TEXT_DIFF_SIZE &&
      toA > fromA + 2 && toB > fromB + 2) {
    let diff = computeDiff(state.a.slice(fromA, toA), state.b.slice(fromB, toB))
    for (let i = 0; i < diff.length; i++) {
      let range = diff[i]
      state.ranges.push({fromA: range.fromA + fromA, toA: range.toA + fromA,
                         fromB: range.fromB + fromB, toB: range.toB + fromB})
    }
  } else {
    state.ranges.push({fromA, toA, fromB, toB})
  }
}

const MIN_NODE_SCAN_SIZE = 256, MAX_NODE_SCAN_LEN = 40

function scanNodes(state: DiffState,
                   fromA: number, lenA: number, a: Text[],
                   fromB: number, lenB: number, b: Text[],
                   maxSize: number = smallestNodeSize(lenA > lenB ? b : a)) {
  let ratio = Math.max(lenA, lenB) / Math.min(lenA, lenB)
  if (ratio > 10) {
    scanText(state, fromA, fromA + lenA, fromB, fromB + lenB)
    return
  }

  let nodesA = nodesUpTo(a, maxSize), nodesB = nodesUpTo(b, maxSize)
  let diff = computeDiff(nodesA, nodesB)
  let nextSize = maxSize >> 1
  for (let i = 0, posA = fromA, posB = fromB, iA = 0, iB = 0; i < diff.length; i++) {
    let range = diff[i]
    while (iA < range.fromA) posA += nodesA[iA++].length
    while (iB < range.fromB) posB += nodesA[iB++].length
    let startIA = iA, startPosA = posA, startIB = iB, startPosB = posB
    while (iA < range.toA) posA += nodesA[iA++].length
    while (iB < range.toB) posB += nodesB[iB++].length
    if (nextSize < MIN_NODE_SCAN_SIZE || Math.max(iA - startIA, iB - startIB) > MAX_NODE_SCAN_LEN)
      scanText(state, startPosA, posA, startPosB, posB)
    else
      scanNodes(state,
                startPosA, startPosA - posA, nodesA.slice(startIA, iA),
                startPosB, startPosB - posB, nodesB.slice(startIB, iB),
                nextSize)
  }
}

function smallestNodeSize(nodes: Text[]): number {
  let size = 1e10
  for (let i = 0; i < nodes.length; i++) size = Math.min(nodes[i].length, size)
  return size
}

function nodesUpTo(nodes: ReadonlyArray<Text>, maxSize: number, result: Text[] = []): Text[] {
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i], children = node.children
    if (!children || node.length <= maxSize) result.push(node)
    else nodesUpTo(children, maxSize, result)
  }
  return result
}

// The function below uses single numbers to store two pieces of
// information—a length and a flag—by using bits 0-29 for the length
// and 30-31 for the flag.
const LEN_MASK = 0x1fffffff, FLAG_SHIFT = 29
const FLAG_DEL = 1 << FLAG_SHIFT, FLAG_INS = 2 << FLAG_SHIFT, FLAG_SAME = 3 << FLAG_SHIFT

interface Seq<T> { length: number; readonly [key: number]: T }

// FIXME engines are probably going to suck at optimizing this because
// we're using it both with arrays and with strings
function computeDiff<T>(a: Seq<T>, b: Seq<T>): ChangedRange[] {
  // Scan from both sides to cheaply eliminate work
  let start = 0, aEnd = a.length, bEnd = b.length, minEnd = Math.min(aEnd, bEnd)
  while (start < minEnd && a[start] == b[start]) start++
  if (start == aEnd && start == bEnd) return []
  while (aEnd > start && bEnd > start && a[aEnd - 1] == b[bEnd - 1]) aEnd--, bEnd--
  if (start == aEnd || start == bEnd || (aEnd == bEnd && aEnd == start + 1))
    return [{fromA: start, toA: aEnd, fromB: start, toB: bEnd}]

  // Longest common subsequence algorithm, based on
  // https://en.wikipedia.org/wiki/Longest_common_subsequence_problem#Code_for_the_dynamic_programming_solution
  let aLen = aEnd - start, table: number[] = []
  for (let y = start, index = 0; y < bEnd; y++) {
    let nodeB = b[y]
    for (let x = start; x < aEnd; x++) {
      let nodeA = a[x]
      if (nodeB == nodeA) {
        table[index] = ((x == start || y == start ? 0 : table[index - 1 - aLen] & LEN_MASK) + 1) | FLAG_SAME
      } else {
        let del = x == start ? 0 : table[index - 1] & LEN_MASK
        let ins = y == start ? 0 : table[index - aLen] & LEN_MASK
        table[index] = del < ins ? ins | FLAG_INS : del | FLAG_DEL
      }
      index++
    }
  }
  let result = []
  for (let x = aEnd, y = bEnd, cur = null, index = table.length - 1; x > start || y > start;) {
    let startX = x, startY = y
    let flag = x == start ? FLAG_INS : y == start ? FLAG_DEL : table[index] & ~LEN_MASK
    if (flag == FLAG_DEL) x--, index--
    else if (flag == FLAG_INS) y--, index -= aLen
    else x--, y--, index -= aLen + 1

    if (flag == FLAG_SAME) cur = null
    else if (cur) cur.fromA = x, cur.fromB = y
    else result.push(cur = {fromA: x, toA: startX, fromB: y, toB: startY})
  }
  return result.reverse()
}
