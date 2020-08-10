import {EditorState, Extension, Transaction, IndentContext} from "@codemirror/next/state"

const DontIndentBeyond = 200

/// Enables reindentation on input. When a language defines an
/// `indentOnInput` field in its [language
/// data](#state.EditorState.languageDataAt), which must hold a
/// regular expression, the line at the cursor will be reindented
/// whenever new text is typed and the input from the start of the
/// line up to the cursor matches that regexp.
///
/// To avoid unneccesary reindents, it is recommended to start the
/// regexp with `^` (usually followed by `\s*`), and end it with `$`.
/// For example, `/^\s*\}$` will reindent when a closing brace is
/// added at the start of a line.
export function indentOnInput(): Extension {
  return EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged || tr.annotation(Transaction.userEvent) != "input") return tr
    let rules = tr.startState.languageDataAt<RegExp>("indentOnInput", tr.startState.selection.primary.head)
    if (!rules.length) return tr
    let doc = tr.newDoc, {head} = tr.newSelection.primary, line = doc.lineAt(head)
    if (head > line.from + DontIndentBeyond) return tr
    let lineStart = doc.sliceString(line.from, head)
    if (!rules.some(r => r.test(lineStart))) return tr
    let {state} = tr, last = -1, changes = []
    for (let {head} of state.selection.ranges) {
      let line = state.doc.lineAt(head)
      if (line.from == last) continue
      last = line.from
      let indent = Math.max(...state.facet(EditorState.indentation).map(f => f(new IndentContext(state), line.from)))
      if (indent < 0) continue
      let cur = /^\s*/.exec(line.slice(0, Math.min(line.length, DontIndentBeyond)))![0]
      let norm = state.indentString(indent)
      if (cur != norm)
        changes.push({from: line.from, to: line.from + cur.length, insert: norm})
    }
    return changes.length ? [tr, {changes}] : tr
  })
}
