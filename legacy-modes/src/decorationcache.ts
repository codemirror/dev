import {Text} from "../../doc/src/text"
import {Range, RangeSet, RangeValue} from "../../rangeset/src/rangeset"
import {Mapping, Transaction} from "../../state/src"
import {DecoratedRange, DecorationSet} from "../../view/src/decoration"

class DecorationsChunk implements RangeValue {
  bias = 2e9
  constructor(readonly decos: ReadonlyArray<DecoratedRange>) {}
  map(mapping: Mapping, from: number, to: number): Range<any> | null {
    // FIXME This does not actually take a Mapping, but rather a ChangeSet
    const unchangedTill = Math.min(...mapping.changes.map(c => c.from))
    return this.cutOff(from, unchangedTill)
  }

  cutOff(from: number, at: number): Range<DecorationsChunk> {
    return new Range(from, at, new DecorationsChunk(this.decos.filter(range => range.from < at)))
  }
}

export type Decorator<S> = (doc: Text, from: number, to: number, startState?: S) => [ReadonlyArray<DecoratedRange>, ReadonlyArray<Range<S>>]

export class DecorationCache<S> {
  constructor(private readonly decorator: Decorator<S>, private readonly doc: Text,
              private modeStates: RangeSet<S> = RangeSet.empty,
              private decorations: RangeSet<DecorationsChunk> = RangeSet.empty) {}

  // This possibly returns decorations outside the given range
  getDecorations(from: number = 0, to: number = this.doc.length): DecorationSet {
    if (from == to) return RangeSet.of([])
    let till = from
    const newDecoChunks: Range<DecorationsChunk>[] = []
    let beginIndex: number | null = null
    let endIndex: number | null = null

    const stateIterator = this.modeStates.iter()
    let lastState: {from: number, value?: S} = {from: 0}
    const calculate = (to: number) => {
      let next
      while ((next = stateIterator.next()) && next.from <= till) lastState = next

      // Cut previous chunk of decorations if necessary
      const prevChunk = newDecoChunks[newDecoChunks.length - 1]
      if (prevChunk && prevChunk.to > lastState.from) {
        newDecoChunks[newDecoChunks.length - 1] = prevChunk.value.cutOff(prevChunk.from, lastState.from)
        // Ignore previous chunk if it was only interesting because of a range we just cut
        if (beginIndex == newDecoChunks.length - 1 && lastState.from <= from) ++beginIndex
      }

      const [decos, states] = this.decorator(this.doc, lastState.from, to, lastState.value)
      if (beginIndex === null) beginIndex = newDecoChunks.length
      newDecoChunks.push(new Range(lastState.from, to, new DecorationsChunk(decos)))
      this.modeStates = this.modeStates.update(states)
      lastState = states[states.length - 1]
    }

    const decoIter = this.decorations.iter()
    for (let decoration; decoration = decoIter.next();) {
      if (till >= to) {
        if (endIndex === null) endIndex = newDecoChunks.length
      } else if (till < decoration.to) {
        if (beginIndex === null && decoration.from < to) beginIndex = newDecoChunks.length
        if (till < decoration.from) calculate(decoration.from)
        till = decoration.to
      }
      newDecoChunks.push(decoration)
    }
    if (till < to) calculate(to)
    if (endIndex === null) endIndex = newDecoChunks.length

    const newDecorations = newDecoChunks.slice(beginIndex!, endIndex).reduce((result: DecoratedRange[], item: Range<DecorationsChunk>) => result.concat(item.value.decos), [])
    newDecoChunks.splice(beginIndex!, endIndex - beginIndex!, new Range(newDecoChunks[beginIndex!].from, newDecoChunks[endIndex - 1].to, new DecorationsChunk(newDecorations)))
    this.decorations = RangeSet.of(newDecoChunks)
    return RangeSet.of(newDecorations)
  }

  getStateBefore(pos: number): {state: S | null, pos: number} {
    const stateIterator = this.modeStates.iter()
    let state: S | null = null, from: number = 0, next
    while ((next = stateIterator.next()) && next.from <= pos) ({value: state, from} = next)
    return {pos: from, state: state}
  }

  update(tr: Transaction): DecorationCache<S> {
    const unchangedTill = Math.min(...tr.changes.changes.map(c => c.from))
    return new DecorationCache(this.decorator, tr.doc,
                               this.modeStates.update([], (from: number, to: number) => from <= unchangedTill),
                               this.decorations.update([], (from: number, to: number) => from < unchangedTill).map(tr.changes))
  }
}
