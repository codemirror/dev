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

### Character Types

@isExtendingChar

@isWordChar

@CharType

@charType
