import {EditorView, Command} from "@codemirror/next/view"

export const toggleCommentCmd: Command = view => {
    console.log("toggle asdf")
    return toggleCommentWithOption(CommentOption.Toggle, view)
}

export const commentCmd: Command = view => {
    console.log("comment asdf")
    return toggleCommentWithOption(CommentOption.OnlyComment, view)
}

export const uncommentCmd: Command = view => {
    console.log("uncomment asdf")
    return toggleCommentWithOption(CommentOption.OnlyUncomment, view)
}

enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

const toggleCommentWithOption = function(option: CommentOption, view: EditorView) {
  const lineCommentToken = "//"
  let s = view.state
  let f = s.selection.primary.from
  let t = s.selection.primary.to
  let l = s.doc.lineAt(f)
  console.log(f, t, l.start)
  let str = (l.content as string)
  if (str.startsWith(lineCommentToken)) {
    if (option != CommentOption.OnlyComment) {
      let tr = view.state.t().replace(l.start, l.start + lineCommentToken.length, "")
      view.dispatch(tr)
      return true
    }

  } else {
    if (option != CommentOption.OnlyUncomment) {
      let tr = view.state.t().replace(l.start, l.start, lineCommentToken)
      view.dispatch(tr)
      return true
    }
  }

  return false
}
