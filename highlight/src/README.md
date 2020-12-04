Syntax highlighting is done by a
[highlighter](#highlight.treeHighlighter), using information from a
[highlight style](#highlight.highlightStyle), which maps style tags
associated with a syntax tree to CSS styles, making sure each
syntactic element is styled appropriately.

Because syntax tree node types and highlight styles have to be able to
talk the same language, CodeMirror uses a mostly _closed_
[vocabulary](#highlight.tags) of syntax tags. It is possible to
[define](#highlight.Tag^define) your own tags, but highlighting will
only happen for tags that are emitted by the
[parser](#language.Language) and recognized by the [highlight
style](#highlight.highlightStyle).

@Tag

@tags

@highlightStyle

@defaultHighlightStyle

@styleTags

@treeHighlighter
