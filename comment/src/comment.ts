import {EditorView, Command} from "@codemirror/next/view"
// import { CloseBracketConfig } from "../../closebrackets/src/closebrackets"
import { EditorState } from "../../state/src/state"
import { Autocompleter } from "../../autocomplete/src"
import { addLanguageData, languageData } from "../../state/src/extension"
import { CloseBracketConfig } from "../../closebrackets/src/closebrackets"

export const toggleCommentCmd: Command = view => {
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
  console.log("view.state", view.state)
  console.log("view.state.facet(addLanguageData)", view.state.facet(addLanguageData))
  console.log("view.state.tree", view.state.tree)

  const lineCommentToken = "//"
  let pos = view.state.selection.primary.from
  let to = view.state.selection.primary.to
  let line = view.state.doc.lineAt(pos)
  console.log("from/pos", pos, "to", to, "start", line.start)

  console.log("resolveAt(pos)", view.state.tree.resolveAt(pos))
  console.log("autocomplete(pos)", view.state.languageDataAt<Autocompleter>("autocomplete", pos))
  console.log("closeBrackets(pos)", view.state.languageDataAt<CloseBracketConfig>("closeBrackets", pos))
  console.log("comment(pos)", view.state.languageDataAt("Comment", pos))
  
  let syntax = view.state.facet(EditorState.syntax)
  console.log(syntax)
  // syntax[0].
  let nodeType = syntax[0].docNodeTypeAt(view.state, pos)
  console.log(nodeType)
  console.log("prop", nodeType.prop(languageData))

  let str = (line.content as string)
  if (str.startsWith(lineCommentToken)) {
    if (option != CommentOption.OnlyComment) {
      let tr = view.state.t().replace(line.start, line.start + lineCommentToken.length, "")
      view.dispatch(tr)
      return true
    }

  } else {
    if (option != CommentOption.OnlyUncomment) {
      let tr = view.state.t().replace(line.start, line.start, lineCommentToken)
      view.dispatch(tr)
      return true
    }
  }

  return false
}
