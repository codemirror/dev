import {Tree, TreeFragment, ChangedRange} from "lezer-tree"
import {StateField, Text, ChangeDesc} from "@codemirror/next/state"
import {DocInput} from "@codemirror/next/syntax"
import {MarkdownParser} from "lezer-markdown"

const syntaxField = StateField.define<ParseState>({
  create(s) { return new ParseState(Tree.empty, []).parse(s.doc, Work.Apply) },
  update(value, tr) { return value.applyChanges(tr.changes).parse(tr.newDoc, Work.Apply) }
})

const enum Work {
  // Milliseconds of work time to perform immediately for a state doc change
  Apply = 25,
  // Minimum amount of work time to perform in an idle callback
  MinSlice = 25,
  // Amount of work time to perform in pseudo-thread when idle callbacks aren't supported
  Slice = 100,
  // Maximum pause (timeout) for the pseudo-thread
  Pause = 200,
  // Don't parse beyond this point unless explicitly requested to with `ensureTree`.
  MaxPos = 5e6
}

export class ParseState {
  constructor(readonly tree: Tree,
              readonly fragments: readonly TreeFragment[]) {}

  parse(doc: Text, timeBudget: number) {
    // FIXME don't do anything when already done
    let parser = new MarkdownParser(new DocInput(doc), {fragments: this.fragments})
    let stopAt = Date.now() + timeBudget
    for (;;) {
      let result = parser.advance()
      if (result) return new ParseState(result, TreeFragment.addTree(result))
      if (Date.now() >= stopAt) {
        let tree = parser.forceFinish()
        return new ParseState(tree, TreeFragment.addTree(tree, this.fragments))
      }
    }
  }

  applyChanges(changes: ChangeDesc, margin?: number) {
    if (changes.empty) return this
    let ranges: ChangedRange[] = []
    changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({fromA, toA, fromB, toB}))
    return new ParseState(Tree.empty, TreeFragment.applyChanges(this.fragments, ranges, margin))
  }
}

export function markdown() {
  return [syntaxField] // FIXME
}
