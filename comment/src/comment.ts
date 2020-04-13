import { Text, Line } from "@codemirror/next/text"
import { EditorView, Command } from "@codemirror/next/view"
import { EditorState, Transaction, SelectionRange, Change } from "@codemirror/next/state"

export const toggleLineCommentCmd: Command = view => {
  return dispatchToggleComment(toggleLineComment(CommentOption.Toggle), view)
}

export const lineCommentCmd: Command = view => {
  return dispatchToggleComment(toggleLineComment(CommentOption.OnlyComment), view)
}

export const lineUncommentCmd: Command = view => {
  return dispatchToggleComment(toggleLineComment(CommentOption.OnlyUncomment), view)
}

export const toggleBlockCommentCmd: Command = view => {
  return dispatchToggleComment(toggleBlockComment(CommentOption.Toggle), view)
}

export const blockCommentCmd: Command = view => {
  return dispatchToggleComment(toggleBlockComment(CommentOption.OnlyComment), view)
}

export const blockUncommentCmd: Command = view => {
  return dispatchToggleComment(toggleBlockComment(CommentOption.OnlyUncomment), view)
}

const dispatchToggleComment = (cmd: (st: EditorState) => Transaction | null, view: EditorView): boolean => {
  let tr = cmd(view.state)
  if (!tr) return false
  view.dispatch(tr)
  return true
}

export enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

export const toggleBlockComment = (option: CommentOption) => (state: EditorState): Transaction | null => {
  type BlockCommentData = { blockComment: { open: string, close: string } | undefined } | undefined
  const data = state.languageDataAt<BlockCommentData>("commentTokens", state.selection.primary.from)[0]
  return data === undefined || data.blockComment === undefined || data.blockComment.open === undefined || data.blockComment.close === undefined
    ? null
    : new BlockCommenter(data.blockComment.open, data.blockComment.close).toggle(option, state)
}

/// This class performs toggle, comment and uncomment
/// of block comments in languages that support them.
/// The `open` and `close` arguments refer to the open and close
/// tokens of which this `BlockCommenter` is made up.
export class BlockCommenter {
  open: string
  close: string
  margin: string
  constructor(open: string, close: string, margin: string = " ") {
    this.open = open
    this.close = close
    this.margin = margin
  }

  toggle(option: CommentOption, state: EditorState): Transaction | null {
    const selectionCommented = this.isSelectionCommented(state)
    if (selectionCommented !== null) {
      if (option !== CommentOption.OnlyComment) {
        const tr = state.t()
        let i = 0
        tr.forEachRange((range: SelectionRange, tr: Transaction) => {
          const open = selectionCommented[i].open
          const close = selectionCommented[i].close
          const copen = new Change(open.pos - this.open.length, open.pos + open.margin, [""])
          const cclose = new Change(close.pos - close.margin, close.pos + this.close.length, [""])
          tr.change([copen, cclose])
          // return new SelectionRange(range.anchor + shift, range.head + shift)
          return range
          i++
        })

        return tr
      }
    } else {
      if (option !== CommentOption.OnlyUncomment) {
        const tr = state.t()
        tr.forEachRange((range: SelectionRange, tr: Transaction) => {
          const copen = new Change(range.from, range.from, tr.startState.splitLines(this.open + this.margin))
          const cclose = new Change(range.to, range.to, tr.startState.splitLines(this.margin + this.close))
          tr.change([copen, cclose])
          const shift = (this.open + this.margin).length
          return new SelectionRange(range.anchor + shift, range.head + shift)
        })

        return tr
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
    type SearchWithType = (this: string, searchString: string, pos?: number) => boolean
    const search = (pos: number, searchString: string, searchWith: SearchWithType, d: 1 | -1, i: 1 | 0): { pos: number, margin: number } | null => {
      const line = state.doc.lineAt(pos)
      const str = line.content as string
      const ss = eatSpace(str, pos - line.start - i, d)
      return searchWith.call(str, searchString, pos + d * ss - line.start)
        ? { pos: pos + d * ss, margin: ss == 0 ? 0 : 1 }
        : null
    }
    const startsWithOpen = search(range.from, this.open, String.prototype.endsWith, -1, 1)
    const endsWithClose = search(range.to, this.close, String.prototype.startsWith, 1, 0)
    return startsWithOpen !== null && endsWithClose !== null
      ? { open: startsWithOpen, close: endsWithClose }
      : null
  }

  /// Inserts a block comment in the given transaction `tr`.
  insert(tr: Transaction, margin: string = " "): Transaction {
    tr.forEachRange((range: SelectionRange, tr: Transaction) => {
      const copen = new Change(range.from, range.from, tr.startState.splitLines(this.open + margin))
      const cclose = new Change(range.to, range.to, tr.startState.splitLines(margin + this.close))
      tr.change([copen, cclose])
      const shift = (this.open + margin).length
      return new SelectionRange(range.anchor + shift, range.head + shift)
    })

    return tr
  }
}

/// TODO: Add docs
export const toggleLineComment = (option: CommentOption) => (state: EditorState): Transaction | null => {
  const commentTokens = state.languageDataAt<{ lineComment: string | undefined } | undefined>("commentTokens", state.selection.primary.from)[0]
  if (commentTokens === undefined || commentTokens.lineComment === undefined) return null
  const lineCommentToken = commentTokens.lineComment

  const k = (range: SelectionRange): string => range.anchor + "," + range.head
  const linesAcrossSelection: Line[] = []
  const linesAcrossRange: { [id: string]: Line[]; } = {};
  for (const range of state.selection.ranges) {
    const lines = getLinesInRange(state.doc, range)
    linesAcrossSelection.push(...lines)
    linesAcrossRange[k(range)] = lines
  }
  const column = isRangeLineCommented(lineCommentToken)(state, linesAcrossSelection)
  if (column.isRangeLineSkipped) {
    if (option != CommentOption.OnlyComment) {
      const tr = state.t()
      const mapRef = tr.mapRef()
      for (const range of state.selection.ranges) {
        const lines = linesAcrossRange[k(range)]
        for (const line of lines) {
          if (lines.length > 1 && column.isLineSkipped[line.number]) continue
          const pos = mapRef.mapPos(line.start + column.minCol)
          const margin = (line.content as string).startsWith(" ", column.minCol + lineCommentToken.length) ? 1 : 0
          removeLineComment(tr, pos, lineCommentToken, margin)
        }
      }
      return tr
    }
  } else {
    if (option != CommentOption.OnlyUncomment) {
      const tr = state.t()
      const mapRef = tr.mapRef()
      for (const range of state.selection.ranges) {
        const lines = linesAcrossRange[k(range)]
        for (const line of lines) {
          if (lines.length > 1 && column.isLineSkipped[line.number]) continue
          const pos = mapRef.mapPos(line.start + column.minCol)
          insertLineComment(tr, pos, lineCommentToken)
        }
      }
      return tr
    }
  }

  return null
}

/// TODO: Add docs
const isRangeLineCommented = (lineCommentToken: string) => (state: EditorState, lines: Line[]): { minCol: number } & { isRangeLineSkipped: boolean } & { isLineSkipped: { [id: number]: boolean } } => {
  let minCol = Infinity
  let isRangeLineDiscarded = true
  const isLineSkipped: { [id: number]: boolean } = []
  for (const line of lines) {
    const str = (line.content as string)
    const col = eatSpace(str)
    if ((lines.length == 1 || col < str.length) && col < minCol) {
      minCol = col
    }
    if (isRangeLineDiscarded && (lines.length == 1 || col < str.length) && !str.startsWith(lineCommentToken, col)) {
      isRangeLineDiscarded = false
    }
    isLineSkipped[line.number] = col == str.length
  }
  return { minCol: minCol, isRangeLineSkipped: isRangeLineDiscarded, isLineSkipped: isLineSkipped }
}

/// Inserts a line-comment.
/// The `pos` argument indicates the absolute position to 
/// insert the line comment within the `state`.
/// The line is commented by inserting a `lineCommentToken`.
/// Additionally, a `margin` is inserted between the
/// `lineCommentToken` and the position following `pos`.
/// It returns the `tr` transaction to allow you to chain calls on `tr`/
export const insertLineComment = (tr: Transaction, pos: number, lineCommentToken: string, margin: string = " "): Transaction => {
  return tr.replace(pos, pos, lineCommentToken + margin)
}

/// Removes a line-comment at the given `pos`.
/// See `insertLineComment`.
export const removeLineComment = (tr: Transaction, pos: number, lineCommentToken: string, marginLen: number = 1): Transaction => {
  return tr.replace(pos, pos + lineCommentToken.length + marginLen, "")
}

/// Computes the lines spanned by `range`.
/// This function is exported for testing purposes.
export const getLinesInRange = (doc: Text, range: SelectionRange): Line[] => {
  let line: Line = doc.lineAt(range.from)
  let lines = []
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

/// Consume whitespace starting from 0 in `str`.
/// Return the number of spaces found in `str` to the first
/// non-whitespace character.
/// Note that in case of all characters are whitespace,
/// it will return the length of `str`.
export const _eatSpace = (str: string): number => {
  let pos = 0
  while (/[\s\u00a0]/.test(str.charAt(pos))) ++pos
  return pos
}

const eatSpace = (str: string, pos: number = 0, direction: 1 | -1 = 1): number => {
  let count = 0
  while (/[\s\u00a0]/.test(str.charAt(pos))) {
    count++
    pos += direction
  }
  return count
}
