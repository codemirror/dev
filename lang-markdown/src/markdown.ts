import {Extension} from "@codemirror/next/state"
import {Language, defineLanguageProp} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {parser as baseParser} from "lezer-markdown"
import {htmlLanguage} from "@codemirror/next/lang-html"

const parser = baseParser.configure({
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
})

/// Language support for Markdown/CommonMark.
export const markdownLanguage = new class extends Language {
  constructor() {
    let data = defineLanguageProp({block: {open: "<!--", close: "-->"}})
    super(data, parser)
  }
} as Language

/// Returns an extension that installs the Markdown language.
export function markdown(): Extension {
  return markdownLanguage
}
