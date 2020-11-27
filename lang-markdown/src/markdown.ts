import {Extension} from "@codemirror/next/state"
import {Language, defineLanguageFacet, languageDataProp, foldNodeProp} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {parser} from "lezer-markdown"
import {htmlLanguage} from "@codemirror/next/lang-html"

// FIXME add indentation (and possibly continue-list) support

/// Language support for Markdown/CommonMark.
export const markdownLanguage = new class extends Language {
  constructor() {
    let data = defineLanguageFacet({block: {open: "<!--", close: "-->"}})
    super(data, parser.configure({
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
        }),
        foldNodeProp.add(type => {
          if (!type.is("Block") || type.is("Document")) return undefined
          return (tree, state) => ({from: state.doc.lineAt(tree.from).to, to: tree.to})
        }),
        languageDataProp.add({
          Document: data
        })
      ],
      htmlParser: htmlLanguage.parser.configure({dialect: "noMatch"}),
    }))
  }
} as Language

/// Returns an extension that installs the Markdown language.
export function markdown(): Extension {
  return markdownLanguage
}
