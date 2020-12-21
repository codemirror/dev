import {Text, Line} from "@codemirror/next/text"
import {EditorState, TransactionSpec, EditorSelection, StateCommand} from "@codemirror/next/state"
import {KeyBinding} from "@codemirror/next/view"

/// An object of this type can be provided as [language
/// data](#state.EditorState.languageDataAt) under a `"commentTokens"`
/// property to configure comment syntax for a language.
export type CommentTokens = {
  /// The block comment syntax, if any. For example, for JavaScript
  /// you'd provide `{open: "/*", close: "*/"}`.
  block?: {open: string, close: string},
  /// The line comment syntax. For example `"//"`.
  line?: string
}

/// Comment or uncomment the current selection. Will use line comments
/// if possible, otherwise falling back to block comments.
export const toggleComment: StateCommand = target => {
  let config = getConfig(target.state)
  return config.line ? toggleLineComment(target) : config.block ? toggleBlockComment(target) : false
}

function command(f: (option: CommentOption, ranges: readonly {readonly from: number, readonly to: number}[],
                     state: EditorState) => TransactionSpec | null,
                 option: CommentOption): StateCommand {
  return ({state, dispatch}) => {
    let tr = f(option, state.selection.ranges, state)
    if (!tr) return false
    dispatch(state.update(tr))
    return true
  }
}

/// Comment or uncomment the current selection using line comments.
/// The line comment syntax is taken from the
/// [`commentTokens`](#comment.CommentTokens) [language
/// data](#state.EditorState.languageData).
export const toggleLineComment = command(changeLineComment, CommentOption.Toggle)

/// Comment the current selection using line comments.
export const lineComment = command(changeLineComment, CommentOption.Comment)

/// Uncomment the current selection using line comments.
export const lineUncomment = command(changeLineComment, CommentOption.Uncomment)

/// Comment or uncomment the current selection using block comments.
/// The block comment syntax is taken from the
/// [`commentTokens`](#comment.CommentTokens) [language
/// data](#state.EditorState.languageData).
export const toggleBlockComment = command(changeBlockComment, CommentOption.Toggle)

/// Comment the current selection using block comments.
export const blockComment = command(changeBlockComment, CommentOption.Comment)

/// Uncomment the current selection using block comments.
export const blockUncomment = command(changeBlockComment, CommentOption.Uncomment)

/// Default key bindings for this package.
///
///  - Ctrl-/ (Cmd-/ on macOS): [`toggleComment`](#comment.toggleComment).
///  - Shift-Alt-a: [`toggleBlockComment`](#comment.toggleBlockComment).
export const commentKeymap: readonly KeyBinding[] = [
  {key: "Mod-/", run: toggleComment},
  {key: "Alt-A", run: toggleBlockComment}
]

const enum CommentOption { Toggle, Comment, Uncomment }

function getConfig(state: EditorState, pos = state.selection.main.head) {
  let data = state.languageDataAt<CommentTokens>("commentTokens", pos)
  return data.length ? data[0] : {}
}

type BlockToken = {open: string, close: string}

type BlockComment = {
  open: {pos: number, margin: number},
  close: {pos: number, margin: number}
}

const SearchMargin = 50

/// Determines if the given range is block-commented in the given
/// state.
function findBlockComment(state: EditorState, {open, close}: BlockToken, from: number, to: number): BlockComment | null {
  let textBefore = state.sliceDoc(from - SearchMargin, from)
  let textAfter = state.sliceDoc(to, to + SearchMargin)
  let spaceBefore = /\s*$/.exec(textBefore)![0].length, spaceAfter = /^\s*/.exec(textAfter)![0].length
  let beforeOff = textBefore.length - spaceBefore
  if (textBefore.slice(beforeOff - open.length, beforeOff) == open &&
    textAfter.slice(spaceAfter, spaceAfter + close.length) == close) {
    return {open: {pos: from - spaceBefore, margin: spaceBefore && 1},
            close: {pos: to + spaceAfter, margin: spaceAfter && 1}}
  }

  let startText: string, endText: string
  if (to - from <= 2 * SearchMargin) {
    startText = endText = state.sliceDoc(from, to)
  } else {
    startText = state.sliceDoc(from, from + SearchMargin)
    endText = state.sliceDoc(to - SearchMargin, to)
  }
  let startSpace = /^\s*/.exec(startText)![0].length, endSpace = /\s*$/.exec(endText)![0].length
  let endOff = endText.length - endSpace - close.length
  if (startText.slice(startSpace, startSpace + open.length) == open &&
      endText.slice(endOff, endOff + close.length) == close) {
    return {open: {pos: from + startSpace + open.length,
                   margin: /\s/.test(startText.charAt(startSpace + open.length)) ? 1 : 0},
            close: {pos: to - endSpace - close.length,
                    margin: /\s/.test(endText.charAt(endOff - 1)) ? 1 : 0}}
  }
  return null
}

// Performs toggle, comment and uncomment of block comments in
// languages that support them.
function changeBlockComment(
  option: CommentOption,
  ranges: readonly {readonly from: number, readonly to: number}[],
  state: EditorState
) {
  let tokens = ranges.map(r => getConfig(state, r.from).block) as {open: string, close: string}[]
  if (!tokens.every(c => c)) return null
  let comments = ranges.map((r, i) => findBlockComment(state, tokens[i], r.from, r.to))
  if (option != CommentOption.Uncomment && !comments.every(c => c)) {
    let index = 0
    return state.changeByRange(range => {
      let {open, close} = tokens[index++]
      if (comments[index]) return {range}
      let shift = open.length + 1
      return {
        changes: [{from: range.from, insert: open + " "}, {from: range.to, insert: " " + close}],
        range: EditorSelection.range(range.anchor + shift, range.head + shift)
      }
    })
  } else if (option != CommentOption.Comment && comments.some(c => c)) {
    let changes = []
    for (let i = 0, comment; i < comments.length; i++) if (comment = comments[i]) {
      let token = tokens[i], {open, close} = comment
      changes.push(
        {from: open.pos - token.open.length, to: open.pos + open.margin},
        {from: close.pos - close.margin, to: close.pos + token.close.length}
      )
    }
    return {changes}
  }
  return null
}

type LineRange = {
  minCol: number,
  commented: boolean,
  skipped: {[id: number]: boolean}
}

function findLineComment(token: string, lines: readonly Line[]): LineRange {
  let minCol = 1e9, commented = null, skipped: {[id: number]: boolean} = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i], col = /^\s*/.exec(line.text)![0].length
    let empty = skipped[line.number] = col == line.length
    if (col < minCol && (!empty || minCol == 1e9 && i == lines.length - 1))
      minCol = col
    if (commented != false && (!empty || commented == null && i == lines.length - 1))
      commented = line.text.slice(col, col + token.length) == token
  }
  return {minCol, commented: commented!, skipped}
}

// Performs toggle, comment and uncomment of line comments.
function changeLineComment(
  option: CommentOption,
  ranges: readonly {readonly from: number, readonly to: number}[],
  state: EditorState
) {
  let lines: Line[][] = [], tokens: string[] = [], lineRanges: LineRange[] = []
  for (let {from, to} of ranges) {
    let token = getConfig(state, from).line
    if (!token) return null
    tokens.push(token)
    let lns = getLinesInRange(state.doc, from, to)
    lines.push(lns)
    lineRanges.push(findLineComment(token, lns))
  }
  if (option != CommentOption.Uncomment && lineRanges.some(c => !c.commented)) {
    let changes = []
    for (let i = 0, lineRange; i < ranges.length; i++) if (!(lineRange = lineRanges[i]).commented) {
      for (let line of lines[i]) {
        if (!lineRange.skipped[line.number] || lines[i].length == 1)
          changes.push({from: line.from + lineRange.minCol, insert: tokens[i] + " "})
      }
    }
    return {changes}
  } else if (option != CommentOption.Comment && lineRanges.some(c => c.commented)) {
    let changes = []
    for (let i = 0, lineRange; i < ranges.length; i++) if ((lineRange = lineRanges[i]).commented) {
      let token = tokens[i]
      for (let line of lines[i]) {
        if (lineRange.skipped[line.number] && lines[i].length > 1) continue
        let pos = line.from + lineRange.minCol
        let posAfter = lineRange.minCol + token.length
        let marginLen = line.text.slice(posAfter, posAfter + 1) == " " ? 1 : 0
        changes.push({from: pos, to: pos + token.length + marginLen})
      }
    }
    return {changes}
  }
  return null
}

function getLinesInRange(doc: Text, from: number, to: number): Line[] {
  let line: Line = doc.lineAt(from), lines = []
  while (line.to < to || (line.from <= to && to <= line.to)) {
    lines.push(line)
    if (line.number == doc.lines) break
    line = doc.line(line.number + 1)
  }
  return lines
}
