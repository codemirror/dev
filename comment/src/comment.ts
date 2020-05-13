import {Text, Line} from "@codemirror/next/text"
import {EditorState, Transaction, SelectionRange, StateCommand} from "@codemirror/next/state"

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

/// Comments or uncomments the current `SelectionRange` using line-comments.
/// The line-comment token is defined on a language basis.
export const toggleLineComment: StateCommand = target => {
  return dispatch(toggleLineCommentWithOption(CommentOption.Toggle), target)
}

/// Comments the current `SelectionRange` using line-comments.
/// The line-comment token is defined on a language basis.
export const lineComment: StateCommand = target => {
  return dispatch(toggleLineCommentWithOption(CommentOption.OnlyComment), target)
}

/// Uncomments the current `SelectionRange` using line-comments.
/// The line-comment token is defined on a language basis.
export const lineUncomment: StateCommand = target => {
  return dispatch(toggleLineCommentWithOption(CommentOption.OnlyUncomment), target)
}

/// Comments or uncomments the current `SelectionRange` using block-comments.
/// The block-comment tokens are defined on a language basis.
export const toggleBlockComment: StateCommand = target => {
  return dispatch(toggleBlockCommentWithOption(CommentOption.Toggle), target)
}

/// Comments the current `SelectionRange` using block-comments.
/// The block-comment tokens are defined on a language basis.
export const blockComment: StateCommand = target => {
  return dispatch(toggleBlockCommentWithOption(CommentOption.OnlyComment), target)
}

/// Uncomments the current `SelectionRange` using block-comments.
/// The block-comment tokens are defined on a language basis.
export const blockUncomment: StateCommand = target => {
  return dispatch(toggleBlockCommentWithOption(CommentOption.OnlyUncomment), target)
}

function dispatch(cmd: (st: EditorState) => Transaction | null,
                  target: { state: EditorState, dispatch: (transaction: Transaction) => void }): boolean {
  const tr = cmd(target.state)
  if (!tr) return false
  target.dispatch(tr)
  return true
}

enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

function getConfig(state: EditorState, pos = state.selection.primary.head) {
  return state.languageDataAt<CommentTokens>("commentTokens", pos)[0] || {}
}

const toggleBlockCommentWithOption = (option: CommentOption) => (state: EditorState): Transaction | null => {
  const config = getConfig(state)
  return config.block ? new BlockCommenter(config.block.open, config.block.close).toggle(option, state) : null
}

const toggleLineCommentWithOption = (option: CommentOption) => (state: EditorState): Transaction | null => {
  const config = getConfig(state)
  return config.line ? new LineCommenter(config.line).toggle(option, state) : null
}

// This class performs toggle, comment and uncomment
// of block comments in languages that support them.
// The `open` and `close` arguments refer to the open and close
// tokens of which this `BlockCommenter` is made up.
class BlockCommenter {
  constructor(readonly open: string, readonly close: string, readonly margin: string = " ") { }

  toggle(option: CommentOption, state: EditorState): Transaction | null {
    const selectionCommented = this.isSelectionCommented(state)
    if (selectionCommented !== null) {
      if (option !== CommentOption.OnlyComment) {
        return state.update({
          changes: selectionCommented.map(({open, close}) => [
            {from: open.pos - this.open.length, to: open.pos + open.margin},
            {from: close.pos - close.margin, to: close.pos + this.close.length}
          ])
        })
      }
    } else {
      if (option !== CommentOption.OnlyUncomment) {
        return state.update(state.changeByRange(range => {
          const shift = (this.open + this.margin).length
          return {
            changes: [{from: range.from, insert: this.open + this.margin},
                      {from: range.to, insert: this.margin + this.close}],
            range: new SelectionRange(range.anchor + shift, range.head + shift)
          }
        }))
      }
    }

    return null
  }

  /// Determines whether all selection ranges in `state` are block-commented.
  isSelectionCommented(state: EditorState): { open: { pos: number, margin: number }, close: { pos: number, margin: number } }[] | null {
    let result = []
    for (const range of state.selection.ranges) {
      const x = this.isRangeCommented(state, range)
      if (x === null) return null
      result.push(x)
    }
    return result
  }

  /// Determines if the `range` is block-commented in the given `state`.
  /// The `range` must be a valid range in `state`.
  isRangeCommented(state: EditorState, range: SelectionRange): { open: { pos: number, margin: number }, close: { pos: number, margin: number } } | null {
    let textBefore = state.doc.slice(range.from - SearchMargin, range.from)
    let textAfter = state.doc.slice(range.to, range.to + SearchMargin)
    let spaceBefore = /\s*$/.exec(textBefore)![0].length, spaceAfter = /^\s*/.exec(textAfter)![0].length
    let beforeOff = textBefore.length - spaceBefore
    if (textBefore.slice(beforeOff - this.open.length, beforeOff) == this.open &&
        textAfter.slice(spaceAfter, spaceAfter + this.close.length) == this.close) {
      return {open: {pos: range.from - spaceBefore, margin: spaceBefore && 1},
              close: {pos: range.to + spaceAfter, margin: spaceAfter && 1}}
    }

    let startText: string, endText: string
    if (range.to - range.from <= 2 * SearchMargin) {
      startText = endText = state.doc.slice(range.from, range.to)
    } else {
      startText = state.doc.slice(range.from, range.from + SearchMargin)
      endText = state.doc.slice(range.to - SearchMargin, range.to)
    }
    let startSpace = /^\s*/.exec(startText)![0].length, endSpace = /\s*$/.exec(endText)![0].length
    let endOff = endText.length - endSpace - this.close.length
    if (startText.slice(startSpace, startSpace + this.open.length) == this.open &&
        endText.slice(endOff, endOff + this.close.length) == this.close) {
      return {open: {pos: range.from + startSpace + this.open.length,
                     margin: /\s/.test(startText.charAt(startSpace + this.open.length)) ? 1 : 0},
              close: {pos: range.to - endSpace - this.close.length,
                      margin: /\s/.test(endText.charAt(endOff - 1)) ? 1 : 0}}
    }

    return null
  }
}

const SearchMargin = 50

// This class performs toggle, comment and uncomment
// of line comments in languages that support them.
// The `lineCommentToken` argument refer to the token of
// which this `LineCommenter` is made up.
class LineCommenter {
  constructor(readonly lineCommentToken: string, readonly margin: string = " ") { }

  toggle(option: CommentOption, state: EditorState): Transaction | null {
    const linesAcrossSelection: Line[] = []
    const linesAcrossRange: { [id: number]: Line[]; } = {};
    for (let i = 0; i < state.selection.ranges.length; i++) {
      const lines = getLinesInRange(state.doc, state.selection.ranges[i])
      linesAcrossSelection.push(...lines)
      linesAcrossRange[i] = lines
    }
    const column = this.isRangeCommented(state, linesAcrossSelection)
    if (column.isRangeLineSkipped) {
      if (option != CommentOption.OnlyComment) {
        let changes = []
        for (let i = 0; i < state.selection.ranges.length; i++) {
          const lines = linesAcrossRange[i]
          for (const line of lines) {
            if (lines.length > 1 && column.isLineSkipped[line.number]) continue
            const pos = line.start + column.minCol
            const posAfter = column.minCol + this.lineCommentToken.length
            const marginLen = line.slice(posAfter, posAfter + 1) == " " ? 1 : 0
            changes.push({from: pos, to: pos + this.lineCommentToken.length + marginLen})
          }
        }
        return state.update({changes})
      }
    } else {
      if (option != CommentOption.OnlyUncomment) {
        let changes = []
        for (let i = 0; i < state.selection.ranges.length; i++) {
          const lines = linesAcrossRange[i]
          for (const line of lines) {
            if (lines.length <= 1 || !column.isLineSkipped[line.number])
              changes.push({from: line.start + column.minCol, insert: this.lineCommentToken + this.margin})
          }
        }
        return state.update({changes})
      }
    }

    return null
  }

  isRangeCommented(_state: EditorState, lines: Line[]): { minCol: number } & { isRangeLineSkipped: boolean } & { isLineSkipped: { [id: number]: boolean } } {
    let minCol = Infinity
    let isRangeLineDiscarded = true
    const isLineSkipped: { [id: number]: boolean } = []
    for (const line of lines) {
      const str = line.slice(0, Math.min(line.length, SearchMargin))
      const col = /^\s*/.exec(str)![0].length
      if ((lines.length == 1 || col < str.length) && col < minCol) {
        minCol = col
      }
      if (isRangeLineDiscarded && (lines.length == 1 || col < str.length) &&
          str.slice(col, col + this.lineCommentToken.length) != this.lineCommentToken) {
        isRangeLineDiscarded = false
      }
      isLineSkipped[line.number] = col == str.length
    }
    return { minCol: minCol, isRangeLineSkipped: isRangeLineDiscarded, isLineSkipped: isLineSkipped }
  }

}

// Computes the lines spanned by `range`.
/// @internal
export function getLinesInRange(doc: Text, range: SelectionRange): Line[] {
  let line: Line = doc.lineAt(range.from)
  const lines = []
  while (line.start + line.length < range.to ||
    (line.start <= range.to && range.to <= line.end)) {
    lines.push(line)
    if (line.number + 1 <= doc.lines) {
      line = doc.line(line.number + 1)
    } else {
      break
    }
  }
  return lines
}
