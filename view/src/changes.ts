import {Transaction} from "../../state/src"

export class ChangedRange {
  constructor(readonly fromA: number,
              readonly toA: number,
              readonly fromB: number,
              readonly toB: number) {}
  extend(toA: number, toB: number): ChangedRange {
    return new ChangedRange(this.fromA, toA, this.fromB, toB)
  }
}

function addChangedRange(ranges: ChangedRange[], fromA: number, toA: number, fromB: number, toB: number) {
  let i = 0
  for (; i < ranges.length; i++) {
    let range = ranges[i]
    if (range.toA < fromA) continue
    if (range.fromA > toA) break
    fromA = Math.min(fromA, range.fromA); toA = Math.max(toA, range.toA)
    fromB = Math.min(fromB, range.fromB); toB = Math.max(toB, range.toB)
    ranges.splice(i--, 1)
  }
  ranges.splice(i, 0, new ChangedRange(fromA, toA, fromB, toB))
}

export function changedRanges(transactions: Transaction[]) {
  let ranges: ChangedRange[] = []
  for (let i = 0; i < transactions.length; i++) {
    let tr = transactions[i]
    for (let j = 0; j < tr.changes.length; j++) {
      let step = tr.changes.changes[j]
      let fromA = step.from, toA = step.to, fromB = step.from, toB = step.from + step.text.length
      for (let k = j == tr.changes.length - 1 ? i + 1 : i; k < transactions.length; k++) {
        let mapping = k == i ? tr.changes.partialMapping(j + 1) : transactions[k].changes
        fromB = mapping.mapPos(fromB, 1); toB = mapping.mapPos(toB, -1)
      }
      for (let k = j ? i : i - 1; k >= 0; k--) {
        let tr = transactions[k]
        let mapping = tr.changes.partialMapping(k == i ? j : tr.changes.length, 0)
        fromA = mapping.mapPos(fromA, 1); toA = mapping.mapPos(toA, -1)
      }
      addChangedRange(ranges, fromA, toA, fromB, toB)
    }
  }
  return ranges
}
