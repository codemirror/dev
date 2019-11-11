import {EditorView} from "../../view"
import {EditorState, SelectionRange, Transaction} from "../../state"
import {Text, isWordChar} from "../../text"
import {codePointAt, fromCodePoint, minPairCodePoint} from "../../text"
import {keyName} from "w3c-keyname"

/// Configures bracket closing behavior for a syntax (via
/// [`languabeData`](#state.languageData)).
export interface CloseBracketData {
  /// The opening brackets to close. Defaults to `["(", "[", "{", "'",
  /// '"']`. Brackets may be single characters or a triple of quotes
  /// (as in `"''''"`).
  closeBrackets?: string[],
  /// Characters in front of which newly opened brackets are
  /// automatically closed. Closing always happens in front of
  /// whitespace. Defaults to `")]}'\":;>"`.
  closeBracketsBefore?: string
}

const defaults = {
  closeBrackets: ["(", "[", "{", "'", '"'],
  closeBracketsBefore: ")]}'\":;>"
}

/// Extension to enable bracket-closing behavior. When a closeable
/// bracket is typed, its closing bracket is immediately inserted
/// after the cursor. When closing a bracket directly in front of that
/// closing bracket, the cursor moves over the existing bracket. When
/// backspacing in between brackets, both are removed.
export const closeBrackets = EditorView.extend.unique<null>(() => {
  return EditorView.handleDOMEvents({keydown})
}, null)

const definedClosing = "()[]{}<>"

function closing(ch: number) {
  for (let i = 0; i < definedClosing.length; i += 2)
    if (definedClosing.charCodeAt(i) == ch) return definedClosing.charAt(i + 1)
  return fromCodePoint(ch < 128 ? ch : ch + 1)
}

function config(state: EditorState, pos: number) {
  let syntax = state.behavior(EditorState.syntax)
  if (syntax.length == 0) return defaults
  return syntax[0].languageDataAt<CloseBracketData>(state, pos)
}

function keydown(view: EditorView, event: KeyboardEvent) {
  if (event.keyCode == 8) { // Backspace
    let tr = handleBackspace(view.state)
    if (!tr) return false
    view.dispatch(tr)
    return true
  }

  let key = keyName(event)
  if (key.length > 2 || key.length == 2 && codePointAt(key, 0) < minPairCodePoint) return false
  let tr = handleInsertion(view.state, key)
  if (!tr) return false
  view.dispatch(tr)
  return true
}

/// Function that implements the extension's backspace behavior.
/// Exported mostly for testing purposes.
export function handleBackspace(state: EditorState) {
  let conf = config(state, state.selection.primary.head)
  let tokens = conf.closeBrackets || defaults.closeBrackets
  let tr = state.t(), dont = null
  tr.forEachRange(range => {
    if (!range.empty) return dont = range
    let before = prevChar(state.doc, range.head)
    for (let token of tokens) {
      if (token == before && nextChar(state.doc, range.head) == closing(codePointAt(token, 0))) {
        tr.replace(range.head - token.length, range.head + token.length, "")
        return new SelectionRange(range.head - token.length)
      }
    }
    return dont = range
  })
  return dont ? null : tr.scrollIntoView()
}

/// Implements the extension's behavior on text insertion. Again,
/// exported mostly for testing.
export function handleInsertion(state: EditorState, ch: string): Transaction | null {
  let conf = config(state, state.selection.primary.head)
  let tokens = conf.closeBrackets || defaults.closeBrackets
  for (let tok of tokens) {
    let closed = closing(codePointAt(tok, 0))
    if (ch == tok)
      return closed == tok ? handleSame(state, tok, tokens.indexOf(tok + tok + tok) > -1) 
        : handleOpen(state, tok, closed, conf.closeBracketsBefore || defaults.closeBracketsBefore)
    if (ch == closed)
      return handleClose(state, tok, closed)
  }
  return null
}

function nextChar(doc: Text, pos: number) {
  let next = doc.slice(pos, pos + 2)
  return next.length == 2 && codePointAt(next, 0) < minPairCodePoint ? next.slice(0, 1) : next
}

function prevChar(doc: Text, pos: number) {
  let prev = doc.slice(pos - 2, pos)
  return prev.length == 2 && codePointAt(prev, 0) < minPairCodePoint ? prev.slice(1) : prev
}

function handleOpen(state: EditorState, open: string, close: string, closeBefore: string) {
  let tr = state.t(), dont = null
  tr.forEachRange(range => {
    if (!range.empty) {
      tr.replace(range.to, range.to, close)
      tr.replace(range.from, range.from, open)
      return new SelectionRange(range.anchor + open.length, range.head + open.length)
    }
    let next = nextChar(state.doc, range.head)
    if (!next || /\s/.test(next) || closeBefore.indexOf(next) > -1) {
      tr.replace(range.head, range.head, open + close)
      return new SelectionRange(range.head + open.length, range.head + open.length)
    }
    return dont = range
  })
  return dont ? null : tr.scrollIntoView()
}

function handleClose(state: EditorState, open: string, close: string) {
  let tr = state.t(), dont = null
  tr.forEachRange(range => {
    if (range.empty && close == nextChar(state.doc, range.head))
      return new SelectionRange(range.head + close.length)
    return dont = range
  })
  return dont ? null : tr.scrollIntoView()
}

// Handles cases where the open and close token are the same, and
// possibly triple quotes (as in `"""abc"""`-style quoting).
function handleSame(state: EditorState, token: string, allowTriple: boolean) {
  let tr = state.t(), dont = null
  tr.forEachRange(range => {
    if (!range.empty) {
      tr.replace(range.to, range.to, token)
      tr.replace(range.from, range.from, token)
      return new SelectionRange(range.anchor + token.length, range.head + token.length)
    }
    let pos = range.head, next = nextChar(state.doc, pos)
    if (next == token) {
      if (nodeStart(state, pos)) {
        tr.replace(pos, pos, token + token)
        return new SelectionRange(pos + token.length)
      } else {
        let isTriple = allowTriple && state.doc.slice(pos, pos + token.length * 3) == token + token + token
        return new SelectionRange(pos + token.length * (isTriple ? 3 : 1))
      }
    } else if (allowTriple && state.doc.slice(pos - 2 * token.length, pos) == token + token &&
               nodeStart(state, pos - 2 * token.length)) {
      tr.replace(pos, pos, token + token + token + token)
      return new SelectionRange(pos + token.length)
    } else if (!isWordChar(next)) {
      let prev = state.doc.slice(pos - 1, pos)
      if (!isWordChar(prev) && prev != token) {
        tr.replace(pos, pos, token + token)
        return new SelectionRange(pos + token.length)
      }
    }
    return dont = range
  })
  return dont ? null : tr.scrollIntoView()
}

function nodeStart(state: EditorState, pos: number) {
  let syntax = state.behavior(EditorState.syntax)
  if (syntax.length == 0) return false
  let tree = syntax[0].getPartialTree(state, pos, pos).resolve(pos + 1)
  return tree.parent && tree.start == pos
}
