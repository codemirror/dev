In its most basic form, the editor state is made up of a current <a
href="#state.EditorState.doc">document</a> and a <a
href="#state.EditorState.selection">selection</a>. Because there are a
lot of extra pieces that an editor might need to keep in its state
(such as an <a href="#history">undo history</a> or <a
href="#state.Syntax">syntax tree</a>), it is possible for extensions
to add additional <a href="#state.StateField">fields</a> to the state
object.

@EditorStateConfig

@EditorState

@SelectionRange

@EditorSelection

@Text

@CharCategory

### Changes and Transactions

CodeMirror treats changes to the document as
[objects](#state.ChangeSet), which are usually part of a
[transaction](#state.Transaction).

This is how you'd make a change to a document (replacing “world” with
“editor”) and create a new state with the updated document:

```javascript
let state = EditorState.create({doc: "hello world"})
let transaction = state.update({changes: {from: 6, to: 11, insert: "editor"}})
console.log(transaction.state.doc.toString()) // "hello editor"
```

@ChangeSpec

@ChangeDesc

@ChangeSet

@TransactionSpec

@ReconfigurationSpec

@StrictTransactionSpec

@Transaction

@Annotation

@AnnotationType

@StateEffect

@StateEffectType

@MapMode

### Extending Editor State

The following are some types and mechanisms used when writing
extensions for the editor state.

@StateCommand

@Extension

@StateField

@Facet

@precedence

@Precedence

@tagExtension

@Syntax

@IndentContext

@languageDataProp

### Utilities

@combineConfig
