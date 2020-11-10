/*import {Tree} from "lezer-tree"
import {ChangeDesc} from "@codemirror/next/state"
import {Fragment, Type, FragmentContext, MarkdownParser} from "./parser"
*/
export {MarkdownParser, Type, Group} from "./parser"

/*
function applyChange(fragments: readonly Fragment[], change: ChangeDesc) {
  let result = [], i = 1, next = fragments.length ? fragments[0] : null
  change.iterGaps((fromA, fromB, length) => {
    let toA = fromA + length
    while (next && next.from < toA) {
      let cut = fragments[i].cut(fromA, toA)
      if (cut) result.push(cut.move(fromB - fromA))
      if (next.to > toA) break
      next = i < fragments.length ? fragments[i++] : null
    }
  })
  return result
}

*/
