import {Extension} from "@codemirror/next/state"
import {Language} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {parser} from "lezer-markdown"
import {htmlLanguage} from "@codemirror/next/lang-html"

/// Language support for Markdown/CommonMark.
export const markdownLanguage = Language.define({
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
    htmlParser: htmlLanguage.parser.configure({dialect: "noMatch"})
  }),
  languageData: {
    commentTokens: {block: {open: "<!--", close: "-->"}}
  }
})

/// Returns an extension that installs the Markdown language.
export function markdown(): Extension {
  return markdownLanguage
}
