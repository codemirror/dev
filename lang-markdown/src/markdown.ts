import {Tree} from "lezer-tree"
import {StateField, ChangeDesc, Text} from "@codemirror/next/state"
import {Fragment, MarkdownParser, FragmentCursor} from "./parser"

export {MarkdownParser, Type, nodeSet} from "./parser"

function applyChange(fragments: readonly Fragment[], change: ChangeDesc) {
  let result: Fragment[] = [], i = 1, next = fragments.length ? fragments[0] : null
  change.iterGaps((fromA, fromB, length) => {
    let toA = fromA + length
    while (next && next.from < toA) {
      let cut = fragments[i].cut(fromA, toA, fromB - fromA)
      if (cut) result.push(cut)
      if (next.to > toA) break
      next = i < fragments.length ? fragments[i++] : null
    }
  })
  return result
}

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

const syntaxField = StateField.define<ParserState>({
  create(s) { return new ParserState(Tree.empty, []).update(new ChangeDesc([0, s.doc.length]), s.doc) },
  update(value, tr) { return value.update(tr.changes, tr.state.doc) }
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

class ParserState {
  constructor(readonly tree: Tree,
              readonly fragments: readonly Fragment[]) {}

  update(changes: ChangeDesc, doc: Text) {
    if (changes.empty) return this
    let fragments = applyChange(this.fragments, changes)
    let tree = parse(doc, fragments, Work.Apply)
    return new ParserState(tree, addTree(new Fragment(tree, doc, 0, 0, tree.length), fragments))
  }
}

function parse(doc: Text, fragments: readonly Fragment[], timeBudget: number) {
  let parser = new MarkdownParser(doc.iterLines())
  let stopAt = Date.now() + timeBudget
  for (let fCursor = new FragmentCursor(fragments);;) {
    if (parser.reuseFragment(fCursor)) {}
    else if (!parser.parseBlock()) break
    if (Date.now() > stopAt) break
  }
  return parser.finish()
}

export function markdown() {
  return [syntaxField] // FIXME
}
