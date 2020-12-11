import {Language, defineLanguageFacet, languageDataProp, foldNodeProp, indentNodeProp,
        LanguageDescription} from "@codemirror/next/language"
import {styleTags, tags as t} from "@codemirror/next/highlight"
import {parser as baseParser} from "lezer-markdown"
import {htmlLanguage} from "@codemirror/next/lang-html"

const data = defineLanguageFacet({block: {open: "<!--", close: "-->"}})

const parser = baseParser.configure({
  props: [
    styleTags({
      "Blockquote/...": t.quote,
      HorizontalRule: t.contentSeparator,
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
    indentNodeProp.add({
      Document: () => null
    }),
    languageDataProp.add({
      Document: data
    })
  ],
  htmlParser: htmlLanguage.parser.configure({dialect: "noMatch"}),
})

/// Language support for Markdown/CommonMark.
export const markdownLanguage = new Language(data, parser)

/// Create an instance of the Markdown language that will, for code
/// blocks, try to find a language that matches the block's info
/// string in `languages` or, if none if found, use `defaultLanguage`
/// to parse the block.
export function markdownWithCodeLanguages(languages: readonly LanguageDescription[], defaultLanguage?: Language) {
  return new Language(data, parser.configure({
    codeParser(info: string) {
      let found = info && LanguageDescription.matchLanguageName(languages, info, true)
      if (!found) return defaultLanguage ? defaultLanguage.parser : null
      if (found.language) return found.language.parser
      found.load()
      return null
    }
  }))
}
