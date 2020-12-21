The `Text` type stores documents in an immutable tree-shaped
representation that allows:

 - Efficient indexing both by code unit offset and by line number.

 - Structure-sharing immutable updates.

 - Access to and iteration over parts of the document without copying
   or concatenating big strings.

Line numbers start at 1. Character positions are counted from zero,
and count each line break and UTF-16 code unit as one unit.

@Text

@Line

@TextIterator

### Column Utilities

@countColumn

@findColumn

### Code Points and Characters

If you support environments that don't yet have `String.fromCodePoint`
and `codePointAt`, this package provides portable replacements for them.

@codePointAt

@fromCodePoint

@codePointSize

@findClusterBreak
