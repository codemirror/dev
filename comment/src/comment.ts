import {Text, Line} from "@codemirror/next/text"
import {EditorView, Command} from "@codemirror/next/view"
import { EditorState, Transaction, SelectionRange } from "@codemirror/next/state"

export const toggleCommentCmd: Command = view => {
    return dispatchToggleComment(CommentOption.Toggle, view)
}

export const commentCmd: Command = view => {
    return dispatchToggleComment(CommentOption.OnlyComment, view)
}

export const uncommentCmd: Command = view => {
    return dispatchToggleComment(CommentOption.OnlyUncomment, view)
}

enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

const dispatchToggleComment = function(option: CommentOption, view: EditorView): boolean {
  let tr = toggleComment(option, view.state)
  if (!tr) return false
  view.dispatch(tr)
  return true
}

const toggleComment = function(option: CommentOption, state: EditorState): Transaction | null {
  console.log("view.state", state)
  // console.log("view.state.facet(addLanguageData)", state.facet(addLanguageData))
  console.log("view.state.tree", state.tree)

  const lineCommentToken = "//"
  let pos = state.selection.primary.from
  let to = state.selection.primary.to
  let line = state.doc.lineAt(pos)
  console.log("from/pos", pos, "to", to, "start", line.start)

  let node = state.tree.resolveAt(pos)
  console.log("resolveAt(pos)", node.name)
  
  let syntax = state.facet(EditorState.syntax)
  console.log(syntax)

  let str = (line.content as string)
  if (str.startsWith(lineCommentToken)) {
    if (option != CommentOption.OnlyComment) {
      let tr = state.t().replace(line.start, line.start + lineCommentToken.length, "")
      return tr
    }
  } else {
    if (option != CommentOption.OnlyUncomment) {
      let tr = state.t().replace(line.start, line.start, lineCommentToken)
      return tr
    }
  }

  return null
}

export const getLinesAcrossRange = function(doc: Text, range: SelectionRange): Line[] {
  let line = doc.lineAt(range.from)
  let lines = []
  while (line.start + line.length < range.to || 
        (line.start <= range.to && range.to <= line.end)) {
    lines.push(line)
    line = doc.line(line.number + 1)
  }
  return lines
} 
