import {Extension} from "@codemirror/next/state"
import {Language} from "@codemirror/next/syntax"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {parser} from "lezer-markdown"
import {htmlSyntax} from "@codemirror/next/lang-html"

export const markdownSyntax = Language.define({
  parser: parser.configure({
    props: [
      styleTags({
        "Blockquote/...": t.quote,
        HorizontalRule: t.atom,
        "ATXHeading/... SetextHeading/...": t.heading,
        "Comment CommentBlock": t.comment,
        Escape: t.escape,
        Entity: t.character,
        "Emphasis/...": t.emphasis,
        "StrongEmphasis/...": t.strong,
        "Link/... Image/...": t.link,
        InlineCode: t.monospace,
        URL: t.url,
        "HeaderMark HardBreak QuoteMark ListMark LinkMark EmphasisMark CodeMark": t.processingInstruction,
        "CodeInfo LinkLabel": t.labelName,
        LinkTitle: t.string
      })
    ],
    htmlParser: htmlSyntax.parser.configure({dialect: "noMatch"})
  }),
  languageData: {
    commentTokens: {block: {open: "<!--", close: "-->"}}
  }
})

export function markdown(): Extension {
  return markdownSyntax
}
