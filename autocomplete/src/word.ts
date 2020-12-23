import {CharCategory} from "@codemirror/next/state"
import {Completion, CompletionSource} from "./completion"

const enum C { Range = 50000 }

/// A completion source that will scan the document for words (using a
/// [character categorizer](#state.EditorState.charCategorizer)), and
/// return those as completions.
export const completeAnyWord: CompletionSource = context => {
  let options: Completion[] = [], seen: {[word: string]: boolean} = Object.create(null)
  let cat = context.state.charCategorizer(context.pos)
  let start = Math.max(0, context.pos - C.Range), end = Math.min(context.state.doc.length, start + C.Range * 2)
  let from = context.pos
  for (let cur = context.state.doc.iterRange(start, end), pos = start; !(cur.next()).done;) {
    let {value} = cur, start = -1
    for (let i = 0;; i++) {
      if (i < value.length && cat(value[i]) == CharCategory.Word) {
        if (start < 0) start = i
      } else if (start > -1) {
        if (pos + start <= context.pos && pos + i >= context.pos) {
          from = pos + start
        } else {
          let word = value.slice(start, i)
          if (!seen[word]) {
            options.push({type: "text", label: word})
            seen[word] = true
          }
        }
        start = -1
      }
      if (i == value.length) break
    }
    pos += value.length
  }
  return {from, options, span: /^\w*/}
}
