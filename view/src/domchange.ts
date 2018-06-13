import {EditorView} from "./view"

export function applyDOMChange(view: EditorView, start: number, end: number) {
  let {from, to, text} = view.docView.readDOMRange(start, end)

  let preferredPos = view.state.selection.primary.from, preferredSide = null
  // Prefer anchoring to end when Backspace is pressed
  if (view.inputState.lastKeyCode === 8 && view.inputState.lastKeyTime > Date.now() - 100) {
    preferredPos = view.state.selection.primary.to
    preferredSide = "end"
  }
  view.inputState.lastKeyCode = 0

  let diff = findDiff(view.state.doc.slice(from, to), text, preferredPos - from, preferredSide)
  if (diff) {
    // FIXME apply generic insertText functionality when appropriate
    // (including mapping selection forward in case of replace), maybe
    // detect enter, allow a textInput hook
    view.dispatch(view.state.transaction.replace(from + diff.from, from + diff.toA, text.slice(diff.from, diff.toB)))
  } else { // Force DOM update to clear damage
    view.setState(view.state)
  }
}

function findDiff(a: string, b: string, preferredPos: number, preferredSide: string | null)
    : {from: number, toA: number, toB: number} | null {
  let minLen = Math.min(a.length, b.length)
  let from = 0
  while (from < minLen && a.charCodeAt(from) == b.charCodeAt(from)) from++
  if (from == minLen && a.length == b.length) return null
  let toA = a.length, toB = b.length
  while (toA > 0 && toB > 0 && a.charCodeAt(toA - 1) == b.charCodeAt(toB - 1)) { toA--; toB-- }

  if (preferredSide == "end") {
    let adjust = Math.max(0, from - Math.min(toA, toB))
    preferredPos -= toA + adjust - from
  }
  if (toA < from && a.length < b.length) {
    let move = preferredPos <= from && preferredPos >= toA ? from - preferredPos : 0
    from -= move
    toB = from + (toB - toA)
    toA = from
  } else if (toB < from) {
    let move = preferredPos <= from && preferredPos >= toB ? from - preferredPos : 0
    from -= move
    toA = from + (toA - toB)
    toB = from
  }
  return {from, toA, toB}
}
