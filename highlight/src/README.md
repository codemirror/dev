Syntax highlighting is done by a
[highlighter](#highlight.highligther), which maps style tags
associated with a syntax tree to CSS styles, making sure each
syntactic element is styled appropriately.

Because syntax tree node types and highlighters have to be able to
talk the same language, CodeMirror uses a _closed_ vocabulary of
syntax types. It is possible to [define](#highlight.TagSystem) your
own vocabulary, but the vocabulary used by the
[syntax](#state.EditorState.syntax) and the highlighter have to agree,
or no highlighting happens.

Each node can be assigned a _tag_. Tags have a type and one or more
flags, which can be used to further refine them. Types may extend
other types. When no style for a given tag is present in the
highlighter, it will fall back first to styles for that type without
one or more flags, and then, if that also fails, to its parent types.
Elements for which no style matches at all are not styled.

These are the types in the [default tagging
system](#highlight.defaultTags). Sublists indicate types that extend
other types.

 * **`comment`**
   * **`lineComment`**
   * **`blockComment`**
 * **`name`** represents any kind of identifier.
   * **`variableName`**
   * **`typeName`**
   * **`propertyName`**
   * **`className`**
   * **`labelName`**
   * **`namespace`**
 * **`literal`**
   * **`string`**
     * **`character`**
   * **`number`**
     * **`integer`**
     * **`float`**
   * **`regexp`**
   * **`escape`**
   * **`color`**
 * **`content`** is used for things like plain text in XML or markup
   documents.
   * **`heading`**
   * **`list`**
   * **`quote`**
 * **`keyword`**
   * **`self`**
   * **`null`**
   * **`atom`**
   * **`unit`**
   * **`modifier`**
   * **`operatorKeyword`**
 * **`operator`**
   * **`derefOperator`**
   * **`arithmeticOperator`**
   * **`logicOperator`**
   * **`bitwiseOperator`**
   * **`compareOperator`**
   * **`updateOperator`**
   * **`typeOperator`**
 * **`punctuation`**
   * **`separator`**
   * **`bracket`**
     * **`paren`**
     * **`brace`**
     * **`angleBracket`**
     * **`squareBracket`**

This collection is heavily biasted towards programming language, and
necessarily incomplete. A full ontology of syntactic constructs would
fill a stack of books, and be impractical to write themes for. So try
to make do with this set, possibly encoding more information with
flags. If all else fails, [open an
issue](https://github.com/codemirror/codemirror.next) to propose a new
type, or create a [custom tag system](#highlight.TagSystem) for your
use case.

Each type can be suffixed with a hash sign and a number from `1` to
`7` to specify a subtype. This can be useful to distinguish elements
not otherwise encodable. For example, if a language has multiple types
of string literals, you can use `string#2` or similar to allow
highlighters to style them differently if they want to.

These flags can be added to every type:

 * **`invalid`** indicates that the node is an error of some kind.
 * **`meta`** is usually used for annotations, syntax-level attributes,
   or other metadata.
 * **`standard`** indicates that a given element is part of the
   language's standard environment.
 * **`link`**, **`strong`**, **`emphasis`**, **`monospace`** can be
   useful in markup languages to add styling information.
 * **`changed`**, **`inserted`**, and **`deleted`** would be
   appropriate in a diff file or other change-tracking syntax.
 * **`definition`** indicates that this is a definition. Often used
   with `name` types to indicate that a name is being defined, or with
   `keyword` or `operator` types to indicate definition syntax.
 * **`constant`** can be used to indicate constant variable names.
 * **`control`** is usually combined with `keyword` or `operator` to
   tag control structures.

Tags are specified with strings that contain zero or more type or flag
names separated by spaces. A tag may contain at most one type name,
and any number of flags. So `"number meta invalid"` indicates a tag
that's of type `number` and has the `meta` and `invalid` flags set.

A tag string may start with the character `+` to indicate that it is
additive. By default, the innermost syntax node active at a given
point determines how a piece of text is styled. Additive tags add
their style to all text, even that inside child nodes.

@styleTags

@highlighter

@defaultHighlighter

@TagSystem

@defaultTags
