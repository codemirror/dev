import {Text, Line} from "@codemirror/next/text"
import {EditorView, Command} from "@codemirror/next/view"
import { EditorState, Transaction, SelectionRange } from "@codemirror/next/state"

export const toggleCommentCmd: Command = view => {
    return false // dispatchToggleComment(CommentOption.Toggle, view)
}

export const commentCmd: Command = view => {
    return false // dispatchToggleComment(CommentOption.OnlyComment, view)
}

export const uncommentCmd: Command = view => {
    return false // dispatchToggleComment(CommentOption.OnlyUncomment, view)
}

export enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

export const dispatchToggleComment = function(option: CommentOption, view: EditorView): boolean {
  // let tr = toggleComment(option, view.state)
  // if (!tr) return false
  // view.dispatch(tr)
  return true
}

  // console.log("view.state", state)
  // // console.log("view.state.facet(addLanguageData)", state.facet(addLanguageData))
  // console.log("view.state.tree", state.tree)

  // const lineCommentToken = "//"
  // let pos = state.selection.primary.from
  // let to = state.selection.primary.to
  // console.log("from/pos", pos, "to", to, "start", line.start)

  // let node = state.tree.resolveAt(pos)
  // console.log("resolveAt(pos)", node.name)
  
  // let syntax = state.facet(EditorState.syntax)
  // console.log(syntax)

export const toggleLineComment = (option: CommentOption, lineCommentToken: string) => (state: EditorState, range: SelectionRange): Transaction | null => {
  let lines = getLinesAcrossRange(state.doc, range)
  let column = isRangeLineCommented(lineCommentToken)(state, lines)
  if (column.iscommented) {
    if (option != CommentOption.OnlyComment) {
      let tr = state.t()
      let mapRef = tr.mapRef()
      for (const line of lines) {
        let margin = (line.content as string).startsWith(" ", column.minCol + lineCommentToken.length) ? 1 : 0
        // let pos = line.start + column.minCol
        let pos = mapRef.mapPos(line.start + column.minCol)
        tr = removeLineComment(tr, pos, lineCommentToken, margin)
      }
      return tr
    }
  } else {
    if (option != CommentOption.OnlyUncomment) {
      let tr = state.t()
      let mapRef = tr.mapRef()
      for (const line of lines) {
        let pos = mapRef.mapPos(line.start + column.minCol)
        tr = insertLineComment(tr, pos, lineCommentToken)
      }
      return tr
    }
  }

  return null
}

///
const isRangeLineCommented = (lineCommentToken: string) => (state: EditorState, lines: Line[]): {minCol:number} & {iscommented:boolean} => {
  let minCol = Infinity
  let iscommented = true
  for (const line of lines) {
    let str = (line.content as string)
    let col = eatSpace(str)
    if (col < minCol) {
      minCol = col
    }
    if (iscommented && !str.startsWith(lineCommentToken, col)) {
      iscommented = false
    }
  }
  return {minCol: minCol, iscommented: iscommented}
}

/// Comments a single line by inserting a line comment.
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

      // pos = tr.mapRef().mapPos(pos,)
  return tr.replace(pos, pos + lineCommentToken.length + marginLen, "")
}

/// This function is exported for testing purposes.
export const getLinesAcrossRange = (doc: Text, range: SelectionRange): Line[] => {
  let line: Line = doc.lineAt(range.from)
  let lines = []
  while (line.start + line.length < range.to ||
        (line.start <= range.to && range.to <= line.end)) {
    lines.push(line)
    doc.lines
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
/// Note that in case of all characters are non-whitespace,
/// it will return the length of `str`.
function eatSpace(str: string): number {
  let pos = 0
  while (/[\s\u00a0]/.test(str.charAt(pos))) ++pos
  return pos
}