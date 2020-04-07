import {Text, Line} from "@codemirror/next/text"
import {EditorView, Command} from "@codemirror/next/view"
import { EditorState, Transaction, SelectionRange } from "@codemirror/next/state"

export const toggleCommentCmd: Command = view => {
  // console.log("view.state", state)
  // // console.log("view.state.facet(addLanguageData)", state.facet(addLanguageData))
  // console.log("view.state.tree", state.tree)
  // let node = state.tree.resolveAt(pos)
  // console.log("resolveAt(pos)", node.name)
  // let syntax = state.facet(EditorState.syntax)
  // console.log(syntax)
  return dispatchToggleComment(CommentOption.Toggle, view)
}

export const commentCmd: Command = view => {
    return dispatchToggleComment(CommentOption.OnlyComment, view)
}

export const uncommentCmd: Command = view => {
    return dispatchToggleComment(CommentOption.OnlyUncomment, view)
}

/// The action to be taken when toggling comments.
export enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

const dispatchToggleComment = (option: CommentOption, view: EditorView): boolean => {
  let tr = toggleLineComment(option, "//")(view.state)
  if (!tr) return false
  view.dispatch(tr)
  return true
}

/// TODO: Add docs
export const toggleLineComment = (option: CommentOption, lineCommentToken: string) => (state: EditorState): Transaction | null => {
  const k = (range: SelectionRange): string => range.anchor + "," + range.head
  const linesAcrossSelection: Line[] = []
  const linesAcrossRange : { [id: string] : Line[]; } = {};
  for (const range of state.selection.ranges) {
    const lines = getLinesAcrossRange(state.doc, range)
    linesAcrossSelection.push(...lines)
    linesAcrossRange[k(range)] = lines
  }
  let column = isRangeLineCommented(lineCommentToken)(state, linesAcrossSelection)
  if (column.isRangeLineSkipped) {
    if (option != CommentOption.OnlyComment) {
      let tr = state.t()
      // tr.forEachRange((range) => {
      let mapRef = tr.mapRef()
      for (const range of state.selection.ranges) {
        for (const line of linesAcrossRange[k(range)]) {
          let margin = (line.content as string).startsWith(" ", column.minCol + lineCommentToken.length) ? 1 : 0
          let pos = mapRef.mapPos(line.start + column.minCol)
          tr = removeLineComment(tr, pos, lineCommentToken, margin)
        }
        // return range
      }
      // })
      return tr
    }
  } else {
    if (option != CommentOption.OnlyUncomment) {
      let tr = state.t()
      // tr.forEachRange((range) => {
        let mapRef = tr.mapRef()
        for (const range of state.selection.ranges) {
          for (const line of linesAcrossRange[k(range)]) {
          // for (const line of lines) {
          let pos = mapRef.mapPos(line.start + column.minCol)
          tr = insertLineComment(tr, pos, lineCommentToken)
        }
      }
        // return range
      // })
      return tr
    }
  }

  return null
}

/// TODO: Add docs
const isRangeLineCommented = (lineCommentToken: string) => (state: EditorState, lines: Line[]): {minCol:number} & {isRangeLineSkipped:boolean} & {ls: boolean[]} => {
  let minCol = Infinity
  let isRangeLineSkipped = true
  let ls = []
  for (const line of lines) {
    let str = (line.content as string)
    let col = eatSpace(str)
    if (col < minCol) {
      minCol = col
    }
    if (isRangeLineSkipped && !str.startsWith(lineCommentToken, col)) {
      isRangeLineSkipped = false
    }
    ls.push(col == str.length)
  }
  return {minCol: minCol, isRangeLineSkipped: isRangeLineSkipped, ls: ls}
}

/// Inserts a line-comment.
/// The `pos` argument indicates the absolute position to 
/// insert the line comment within the `state`.
/// The line is commented by inserting a `lineCommentToken`.
/// Additionally, a `margin` is inserted between the
/// `lineCommentToken` and the position following `pos`.
export const insertLineComment = (tr: Transaction, pos: number, lineCommentToken: string, margin: string = " "): Transaction => {
  return tr.replace(pos, pos, lineCommentToken + margin)
}

/// See `insertLineComment`.
export const removeLineComment = (tr: Transaction, pos: number, lineCommentToken: string, marginLen: number = 1): Transaction => {
  return tr.replace(pos, pos + lineCommentToken.length + marginLen, "")
}

/// This function is exported for testing purposes.
export const getLinesAcrossRange = (doc: Text, range: SelectionRange): Line[] => {
  let line: Line = doc.lineAt(range.from)
  let lines = []
  while (line.start + line.length < range.to ||
        (line.start <= range.to && range.to <= line.end)) {
    lines.push(line)
    if (line.number + 1 <= doc.lines ) {
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
function eatSpace(str: string): number {
  let pos = 0
  while (/[\s\u00a0]/.test(str.charAt(pos))) ++pos
  return pos
}