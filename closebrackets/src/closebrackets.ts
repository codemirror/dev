import {EditorView, KeyBinding} from "@codemirror/next/view"
import {EditorState, EditorSelection, Transaction, CharCategory, Extension, StateCommand} from "@codemirror/next/state"
import {Text} from "@codemirror/next/text"
import {codePointAt, fromCodePoint, codePointSize} from "@codemirror/next/text"

/// Configures bracket closing behavior for a syntax (via
/// [language data](#state.languageDataAt)) using the `"closeBrackets"`
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
/// closing bracket, the cursor moves over the existing bracket.
export function closeBrackets(): Extension {
  return EditorView.inputHandler.of(handleInput)
}

const definedClosing = "()[]{}<>"

function closing(ch: number) {
  for (let i = 0; i < definedClosing.length; i += 2)
    if (definedClosing.charCodeAt(i) == ch) return definedClosing.charAt(i + 1)
  return fromCodePoint(ch < 128 ? ch : ch + 1)
}

function config(state: EditorState, pos: number) {
  return state.languageDataAt<CloseBracketConfig>("closeBrackets", pos)[0] || defaults
}

function handleInput(view: EditorView, from: number, to: number, insert: string) {
  if (view.composing) return false
  let sel = view.state.selection.primary
  if (insert.length > 2 || insert.length == 2 && codePointSize(codePointAt(insert, 0)) == 1 ||
      from != sel.from || to != sel.to) return false
  let tr = handleInsertion(view.state, insert)
  if (!tr) return false
  view.dispatch(tr)
  return true
}

/// Command that implements deleting a pair of matching brackets when
/// the cursor is between them.
export const deleteBracketPair: StateCommand = ({state, dispatch}) => {
  let conf = config(state, state.selection.primary.head)
  let tokens = conf.brackets || defaults.brackets
  let dont = null, changes = state.changeByRange(range => {
    if (range.empty) {
      let before = prevChar(state.doc, range.head)
      for (let token of tokens) {
        if (token == before && nextChar(state.doc, range.head) == closing(codePointAt(token, 0)))
          return {changes: {from: range.head - token.length, to: range.head + token.length},
                  range: EditorSelection.cursor(range.head - token.length),
                  annotations: Transaction.userEvent.of("delete")}
      }
    }
    return {range: dont = range}
  })
  if (!dont) dispatch(state.update(changes, {scrollIntoView: true}))
  return !dont
}

/// Close-brackets related key bindings. Binds Backspace to
/// [`deleteBracketPair`](#closebrackets.deleteBracketPair).
export const closeBracketsKeymap: readonly KeyBinding[] = [
  {key: "Backspace", run: deleteBracketPair}
]

/// Implements the extension's behavior on text insertion. @internal
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
  let next = doc.sliceString(pos, pos + 2)
  return next.slice(0, codePointSize(codePointAt(next, 0)))
}

function prevChar(doc: Text, pos: number) {
  let prev = doc.sliceString(pos - 2, pos)
  return codePointSize(codePointAt(prev, 0)) == prev.length ? prev : prev.slice(1)
}

function handleOpen(state: EditorState, open: string, close: string, closeBefore: string) {
  let dont = null, changes = state.changeByRange(range => {
    if (!range.empty)
      return {changes: [{insert: open, from: range.from}, {insert: close, from: range.to}],
              range: EditorSelection.range(range.anchor + open.length, range.head + open.length)}
    let next = nextChar(state.doc, range.head)
    if (!next || /\s/.test(next) || closeBefore.indexOf(next) > -1)
      return {changes: {insert: open + close, from: range.head},
              range: EditorSelection.cursor(range.head + open.length)}
    return {range: dont = range}
  })
  return dont ? null : state.update(changes, {scrollIntoView: true, annotations: Transaction.userEvent.of("input")})
}

function handleClose(state: EditorState, _open: string, close: string) {
  let dont = null, moved = state.selection.ranges.map(range => {
    if (range.empty && nextChar(state.doc, range.head) == close) return EditorSelection.cursor(range.head + close.length)
    return dont = range
  })
  return dont ? null : state.update({selection: EditorSelection.create(moved, state.selection.primaryIndex),
                                 scrollIntoView: true})
}

// Handles cases where the open and close token are the same, and
// possibly triple quotes (as in `"""abc"""`-style quoting).
function handleSame(state: EditorState, token: string, allowTriple: boolean) {
  let dont = null, changes = state.changeByRange(range => {
    if (!range.empty)
      return {changes: [{insert: token, from: range.from}, {insert: token, from: range.to}],
              range: EditorSelection.range(range.anchor + token.length, range.head + token.length)}
    let pos = range.head, next = nextChar(state.doc, pos)
    if (next == token) {
      if (nodeStart(state, pos)) {
        return {changes: {insert: token + token, from: pos},
                range: EditorSelection.cursor(pos + token.length)}
      } else {
        let isTriple = allowTriple && state.sliceDoc(pos, pos + token.length * 3) == token + token + token
        return {range: EditorSelection.cursor(pos + token.length * (isTriple ? 3 : 1))}
      }
    } else if (allowTriple && state.sliceDoc(pos - 2 * token.length, pos) == token + token &&
               nodeStart(state, pos - 2 * token.length)) {
      return {changes: {insert: token + token + token + token, from: pos},
              range: EditorSelection.cursor(pos + token.length)}
    } else if (state.charCategorizer(pos)(next) != CharCategory.Word) {
      let prev = state.sliceDoc(pos - 1, pos)
      if (prev != token && state.charCategorizer(pos)(prev) != CharCategory.Word)
        return {changes: {insert: token + token, from: pos},
                range: EditorSelection.cursor(pos + token.length)}
    }
    return {range: dont = range}
  })
  return dont ? null : state.update(changes, {scrollIntoView: true, annotations: Transaction.userEvent.of("input")})
}

function nodeStart(state: EditorState, pos: number) {
  let tree = state.tree.resolve(pos + 1)
  return tree.parent && tree.from == pos
}
