import {Tree} from "lezer-tree"
import {StateField, ChangeDesc, Text} from "@codemirror/next/state"
import {Fragment, MarkdownParser, FragmentCursor} from "./parser"

export {MarkdownParser, Type, nodeSet} from "./parser"

function addTree(tree: Fragment, fragments: readonly Fragment[]) {
  let result = [tree]
  for (let f of fragments) {
    if (f.from >= tree.to) {
      result.push(f)
    } else if (f.to > tree.to) {
      let part = f.cut(tree.to, f.to, 0)
      if (part) result.push(part)
    }
  }
  return result
}

const syntaxField = StateField.define<ParseState>({
  create(s) { return new ParseState(Tree.empty, []).parse(s.doc, Work.Apply) },
  update(value, tr) { return value.applyChanges(tr.changes, tr.startState.doc).parse(tr.newDoc, Work.Apply) }
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
              readonly fragments: readonly Fragment[]) {}

  applyChanges(change: ChangeDesc, oldDoc: Text) {
    if (change.empty) return this
    let fragments: Fragment[] = [], i = 1, next = this.fragments.length ? this.fragments[0] : null
    change.iterGaps((fromA, fromB, length) => {
      let toA = fromA + length, off = fromA - fromB
      // Drop a full line at the start and end of the region
      if (toA < change.length) toA = oldDoc.lineAt(toA - 1).from - 1
      if (fromA > 0) fromA = oldDoc.lineAt(fromA + 1).to + 1
      if (toA - fromA > 32) while (next && next.from < toA) {
        let cut = next.cut(fromA, toA, off)
        if (cut) fragments.push(cut)
        if (next.to > toA) break
        next = i < this.fragments.length ? this.fragments[i++] : null
      }
    })
    return new ParseState(Tree.empty, fragments)
  }

  parse(doc: Text, timeBudget: number) {
    let parser = new MarkdownParser(doc.iterLines())
    let stopAt = Date.now() + timeBudget
    let fCursor = new FragmentCursor(this.fragments)
    while ((parser.reuseFragment(fCursor) || parser.parseBlock()) &&
           Date.now() < stopAt) {}
    let tree = parser.finish()
    return new ParseState(tree, addTree(new Fragment(tree, doc, 0, 0, tree.length), this.fragments))
  }
}

export function markdown() {
  return [syntaxField] // FIXME
}
