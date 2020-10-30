Syntax highlighting is done by a
[highlighter](#highlight.highlighter), which maps style tags
associated with a syntax tree to CSS styles, making sure each
syntactic element is styled appropriately.

Because syntax tree node types and highlighters have to be able to
talk the same language, CodeMirror uses a _closed_ vocabulary of
syntax types. It is possible to [define](#highlight.TagSystem) your
own vocabulary, but the vocabulary used by the
[syntax](#state.EditorState^syntax) and the highlighter have to agree,
or no highlighting happens.

Each node can be assigned a _tag_. Tags have a type and one or more
flags, which can be used to further refine them. Types may extend
other types. When no style for a given tag is present in the
highlighter, it will fall back first to styles for that type without
one or more flags, and then, if that also fails, to its parent types.
Elements for which no style matches at all are not styled.

@Tag

@tags

@highlightStyle

@defaultHighlightStyle

@styleTags

@treeHighlighter
