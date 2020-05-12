import {EditorView} from "@codemirror/next/view"
import {EditorState, EditorSelection, SelectionRange, Transaction} from "@codemirror/next/state"
import {Text, isWordChar} from "@codemirror/next/text"
import {codePointAt, fromCodePoint, minPairCodePoint} from "@codemirror/next/text"
import {keyName} from "w3c-keyname"

/// Configures bracket closing behavior for a syntax (via
/// [`languageData`](#state.languageData)) using the `"closeBrackets"`
/// identifier.
export interface CloseBracketConfig {
  /// The opening brackets to close. Defaults to `["(", "[", "{", "'",
  /// '"']`. Brackets may be single characters or a triple of quotes
  /// (as in `"''''"`).
  brackets?: string[],
  /// Characters in front of which newly opened brackets are
  /// automatically closed. Closing always happens in front of
  /// whitespace. Defaults to `")]}'\":;>"`.
  before?: string
}

const defaults: Required<CloseBracketConfig> = {
  brackets: ["(", "[", "{", "'", '"'],
  before: ")]}'\":;>"
}

/// Extension to enable bracket-closing behavior. When a closeable
/// bracket is typed, its closing bracket is immediately inserted
/// after the cursor. When closing a bracket directly in front of that
/// closing bracket, the cursor moves over the existing bracket. When
/// backspacing in between brackets, both are removed.
export const closeBrackets = EditorView.domEventHandlers({keydown})

const definedClosing = "()[]{}<>"

function closing(ch: number) {
  for (let i = 0; i < definedClosing.length; i += 2)
    if (definedClosing.charCodeAt(i) == ch) return definedClosing.charAt(i + 1)
  return fromCodePoint(ch < 128 ? ch : ch + 1)
}

function config(state: EditorState, pos: number) {
  return state.languageDataAt<CloseBracketConfig>("closeBrackets", pos)[0] || defaults
}

function keydown(event: KeyboardEvent, view: EditorView) {
  if (event.ctrlKey || event.metaKey) return false

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
  let tokens = conf.brackets || defaults.brackets
  let dont = null, changes = state.changeByRange(range => {
    if (range.empty) {
      let before = prevChar(state.doc, range.head)
      for (let token of tokens) {
        if (token == before && nextChar(state.doc, range.head) == closing(codePointAt(token, 0)))
          return {changes: {from: range.head - token.length, to: range.head + token.length},
                  range: new SelectionRange(range.head - token.length)}
      }
    }
    return {range: dont = range}
  })
  return dont ? null : state.tr(changes, {scrollIntoView: true})
}

/// Implements the extension's behavior on text insertion. Again,
/// exported mostly for testing.
export function handleInsertion(state: EditorState, ch: string): Transaction | null {
  let conf = config(state, state.selection.primary.head)
  let tokens = conf.brackets || defaults.brackets
  for (let tok of tokens) {
    let closed = closing(codePointAt(tok, 0))
    if (ch == tok)
      return closed == tok ? handleSame(state, tok, tokens.indexOf(tok + tok + tok) > -1) 
        : handleOpen(state, tok, closed, conf.before || defaults.before)
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
  let dont = null, changes = state.changeByRange(range => {
    if (!range.empty)
      return {changes: [{insert: open, from: range.from}, {insert: close, from: range.to}],
              range: new SelectionRange(range.anchor + open.length, range.head + open.length)}
    let next = nextChar(state.doc, range.head)
    if (!next || /\s/.test(next) || closeBefore.indexOf(next) > -1)
      return {changes: {insert: open + close, from: range.head},
              range: new SelectionRange(range.head + open.length)}
    return {range: dont = range}
  })
  return dont ? null : state.tr(changes, {scrollIntoView: true})
}

function handleClose(state: EditorState, _open: string, close: string) {
  let dont = null, moved = state.selection.ranges.map(range => {
    if (range.empty && nextChar(state.doc, range.head) == close) return new SelectionRange(range.head + close.length)
    return dont = range
  })
  return dont ? null : state.tr({selection: EditorSelection.create(moved, state.selection.primaryIndex),
                                 scrollIntoView: true})
}

// Handles cases where the open and close token are the same, and
// possibly triple quotes (as in `"""abc"""`-style quoting).
function handleSame(state: EditorState, token: string, allowTriple: boolean) {
  let dont = null, changes = state.changeByRange(range => {
    if (!range.empty)
      return {changes: [{insert: token, from: range.from}, {insert: token, from: range.to}],
              range: new SelectionRange(range.anchor + token.length, range.head + token.length)}
    let pos = range.head, next = nextChar(state.doc, pos)
    if (next == token) {
      if (nodeStart(state, pos)) {
        return {changes: {insert: token + token, from: pos},
                range: new SelectionRange(pos + token.length)}
      } else {
        let isTriple = allowTriple && state.doc.slice(pos, pos + token.length * 3) == token + token + token
        return {range: new SelectionRange(pos + token.length * (isTriple ? 3 : 1))}
      }
    } else if (allowTriple && state.doc.slice(pos - 2 * token.length, pos) == token + token &&
               nodeStart(state, pos - 2 * token.length)) {
      return {changes: {insert: token + token + token + token, from: pos},
              range: new SelectionRange(pos + token.length)}
    } else if (!isWordChar(next)) {
      let prev = state.doc.slice(pos - 1, pos)
      if (!isWordChar(prev) && prev != token)
        return {changes: {insert: token + token, from: pos},
                range: new SelectionRange(pos + token.length)}
    }
    return {range: dont = range}
  })
  return dont ? null : state.tr(changes, {scrollIntoView: true})
}

function nodeStart(state: EditorState, pos: number) {
  let tree = state.tree.resolve(pos + 1)
  return tree.parent && tree.start == pos
}
