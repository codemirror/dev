## 0.16.0 (2020-12-28)

### Breaking changes

`hoverTooltip`'s callback function now takes a position and a side, rather than a predicate function, to determine whether a tooltip should be shown.

The `highlightStyle` function, which defines a highlight style, is now called `HighlightStyle.define`.

`completeSnippets` no longer exists. Use `completeFromList` in combination with `snippetCompletion`.

The `...Support` functions that some language packages exported are gone, since it is now possible to get the support extensions directly from the package's main function.

The `language` facet now returns an optional single language, not an array anymore.

Languages no longer have `getTree` and `ensureTree` methods.

`keymap` is now a facet, rather than a function, which means you have to use it with `keymap.of(...)`.

The `markers` option to gutters now takes a view, rather than a state, as argument.

The `completionKeymap` array now contains more default bindings.

Removes support for `Text.iterLines`.

`Line` objects no longer have `slice` and `findClusterBreak` methods (use `text` and the top-level `findClusterBreak` function instead).

`EditorSelection.primary` is now called `EditorSelection.main`.

`rectangularSelection` now takes its configuration as an object.

A state field's `provide` option works differently. It now takes a function from the field to an extension. `Facet.from` has been changed to make it easy to use with this option.

To set an extension's precedence, use the properties of the `Prec` object instead of the old `precedence` function.

`ViewUpdate.prevState` has been renamed to `startState`.

The `gotoLine` command is now part of the search package.

`highlightActiveLine` is now exported from the view package instead of the highlight-selection package.

The `highlightSelectionMatches` extension is now part of the search package.

### Bug fixes

Fix issue where `hoverTooltip` would falsely believe the mouse was outside of the editor when initialized with the pointer already on the editor.

Drop duplicate completions.

### New features

Highlight styles are now instances of an exported `HighlightStyle` class, which allows you to get at its style module and match it against tags.

The highlight package exports a new function, `highlightTree`, which runs the tree highlighter over a Lezer tree and tells you which styling should be applied where.

`Language` objects now have a `parseString` method that can be used to synchronously parse a string of code in that language.

When configuring an XML schema, it is now possible to provide text to complete into a given element.

`Language` objects now have a `findRegions` method that tells you where in the document the language occurs.

`Language` objects have a new `isActiveAt` method that tells you whether the language is active at a given point.

The Markdown package now exports two new commands, `insertNewlineContinueMarkup` and `deleteMarkupBackward`, to help with editing Markdown.

The new language-data package lists a large number of modes, with some metadata to help locate the one you're interested in.

The language package now exports a `LanguageDescription` type that can be used to provide metadata about language packages.

The CSS language package now exports a basic CSS completion source.

Language packages' main interface function now returns an instance of `LanguageSupport` which provides access both to support extensions and the main language.

The new top-level `ensureSyntaxTree` function in the language package replaces `Language.ensureTree`.

Facets can now come with extensions that should be enabled when they are present in a state.

The keys used for snippet field navigation are now configurable through the `snippetKeymap` facet.

The autocomplete package now exports a `completeAnyWord` function that will gather completions from any words found in the document.

You can now pass `defaultKeymap: false` to `autocompletion` to prevent it from adding its default completion keymap.

`StateField.init` can now be used to provide a custom initial value for a field.

`EditorState.toJSON` and `fromJSON` now allow you to opt in to serializing state fields.

`Line` objects now have a `text` property holding their entire content.

The new `toggleComment` command will automatically create a line or block comment depending on what syntax the language supports.

The `gotoLine` command now allows relative offsets (with `+` and `-`), percentages (with a `%` at the end) and column positions (using `:` before the column number)

## 0.15.0 (2020-12-04)

### Breaking changes

The highlighting system no longer has the concept of a tag system—rather, all tags now exist in the same space.

Highlighting tags are now represented by objects (with the default tag system under `tags` in the highlight package) rather than strings.

Highlighting styles are now registered separately from the actual highlighter plugin. Syntax addons take care of registering the highlighter. Styles are defined with the `highlightStyle` function.

The `syntax` package no longer exists. Its responsibilities have been taken over by the `language` package.

Language and syntax-related functionality that used to live in the `state` package (the syntax provider type, props like `indentation` and `foldable`) has been moved to the `language` package.

The `stream-syntax` package has been renamed to `stream-parser`, and its interface has been changed to make use of the abstractions provided by the `language` package.

Providing language data now works differently (the `globalLanguageData` facet is gone, replaced by a more general `languageData` facet).

`EditorState.tree` has been replaced by the `syntaxTree` function from the `language` package (since the state package no longer knows about Lezer types).

The `...Syntax` exports from language packages have all been renamed to `...Language` for consistency with the library's terminology.

### Bug fixes

`closeBrackets` will no longer type-over brackets that it did not itself insert.

Selection drawing in wrapped lines is no longer entirely broken.

Fix an issue where autocompletion wouldn't trigger when an IME composition moved the selection before ending.

Fix a bug where the facet dependency tracking got confused when a dynamic facet depended on another facet that didn't exist in the state.

Querying the coordinates (and thus drawing the cursor) before a block widget no longer crashes.

Fix double-height cursor on line wrap points in Safari.

Actually call `ignoreEvent` methods on block widgets.

Prevent `drawSelection` from also hiding the native selection in block widgets.

A text cursor created with `Text.iterLines` now actually respects the skip parameter.

### New Features

The `language` package now provides most language and parsing related infrastructure. Unlike the old `syntax` package, it is parse-technique-agnostic. Some of the interfaces that used to live in `state`, such as the facets and types involved in indentation and folding, have also moved there.

The function passed to `changeByRange` may now also return effects for each range.

The new `State.transactionExtender` facet allows you to register functions that add annotations, effects, or reconfiguration to transactions even when they have disabled regular transaction filters.

The new `lang-markdown` package provides Markdown highlighting.

The `foldable` function exported from the language package provides an easy way to check whether a given line is foldable.

The `getIndentation` utility from the language package should now be used to compute automatic indentation for a line. It returns null, as opposed to -1, to indicate that it has no indentation for a given line.

## 0.14.0 (2020-10-23)

### Breaking changes

Lezer and lezer-tree have been upgraded to 0.12, which introduces a few breaking changes.

`ChangeDesc.mapPos` now returns null instead of -1 when reporting a deletion.

`EditorView.posAtCoords` now returns null, rather than -1, when it fails to find a position.

### Bug fixes

Fix an issue where Chrome's shift-enter shortcut confused the editor.

Clicking on the completion list scrollbar no longer selects the first completion.

### New features

The lang-json package now exports a `jsonParseLinter` function that produces a linter based on `JSON.parse`.

## 0.13.1 (2020-10-14)

### Bug fixes

Fix an occasional crash on vertical cursor motion through a scrollable editor.

Fix a bug that caused `Change.fromJSON` to return invalid change objects in some cases.

Fix a bug where the selection and cursor were drawn in the wrong place in a scrolled editor.

## 0.13.0 (2020-10-01)

### Breaking changes

Themes are now specified differently, using plain CSS selectors extended with `$` syntax for targeting theme classes. This should make them more flexible.

The style-mod dependency has been upgraded to 3.0, which is a backward-incompatible upgrade.

The `multipleSelections` extension is no longer supported. You probably want to use `drawSelection` combined with `EditorState.allowMultipleSelections.of(true)`.

`WidgetType` no longer takes a type parameter. Implementations are now themselves responsible for creating instance variables and implementing an appropriate `eq` method.

Drops support for `PluginValue.measure` (which was very broken already in the previous release).

### Bug fixes

The editor no longer loses focus when picking a completion with the mouse.

Fix a bug that caused completion info tooltips to be positioned off-screen.

### New features

There is now an SQL language module.

The autocomplete package now exports an `ifNotIn` helper that can turn off completion sources when the cursor is in a given token type.

There is now a `lang-xml` package with basic XML support.

`ViewUpdate` objects now have a `geometryChanged` getter that tells you whether the geometry of the content changed.

The view module now exports a `drawSelection` function that creates an extension that overrides the native selection drawing.

Scroll handlers registered view `EditorView.domEventHandlers` or view plugins will now be called any time the view or an ancestor of the view is scrolled.

DOM event handlers may now return void, for convenience.

There is now a `lang-rust` package.

The view package now exports a `placeholder` function that can be used to create a placeholder shown when the editor is empty.

The editor view now has a `composing` property indicating whether IME is active.

The autocomplete package now exports `acceptCompletion` and `moveCompletionSelection` commands.

## 0.12.0 (2020-09-11)

### Breaking changes

The way overlapping mark decorations are handled has changed. The editor will now create a separate element for each decoration, and nested them in order of the predecence of the sources that created them (higher precedence wrapping lower precedence, decorations from the state facet wrapping decorations from view plugins).

Registering decorations, event handlers, or other plugin values for a view plugin is now done differently (with an argument to `ViewPlugin.define` or `ViewPlugin.fromClass`, rather than method calls on the returned value).

### Bug fixes

Vertical cursor motion when the selection isn't empty will now properly collapse it to the appropriate side, rather than moving from the selection head.

Fix the `activateOnTyping` option to the autocomplete system.

The default backspace binding now deletes by code point, not character.

Tooltips are no longer cut off by scrollable parent elements.

### New features

`StreamParser` now allows an optional `tagSystem` property to use a custom tag system.

Elements created for mark decorations can now span multiple child elements (raw text, or elements created for lower-precedence marks or widgets).

There is now a lang-java package with a Java syntax.

There is now a dedicated syntax tag for boolean literals ("bool").

Add a C++ syntax.

New commands `deleteCodePointForward`/`Backward`.

The editor view now has an `inView` getter that tells you if the editor is in view at all.

View plugins can now provide a `measure` method that gets called when the view measures itself.

## 0.11.0 (2020-09-03)

### Breaking changes

Autocompletion contexts no longer have a `filter` method. Completion sources shouldn't filter anymore, but leave that to the plugin.

The `filterDownOn` property on completion results is now called `span`.

`AutocompleteContext.tokenBefore` now takes a list of token type names, and only returns tokens of those types. (In its previous form, it was too error-prone.)

Snippet specs no longer support a `name` property (use `detail` instead).

A number of exports from the autocomplete plugin were renamed: `autocomplete` to `autocompletion`, `AutocompleteContext` to `CompletionContext`, `Autocompleter` to `CompletionSource`.

`SnippetSpec` objects are now a subclass of `Completion` (which mostly means that their `keyword` property was renamed to `label`).

### Bug fixes

Fix issue that could cause crashes or incorrectly mapped selections in the history when making changes with `addToHistory` set to false.

Fuzzy completion matching got a lot more clever, and presents results ordered by match quality.

### New features

Text copied linewise will now be inserted as lines above the selection when pasted into an empty selection.

The completion list now shows the matched parts of the strings.

The autocomplete package now exports two new functions, `completionStatus` and `currentCompletions`, that let external code query its state.

A new method `matchBefore` on the autocompletion context can now be used to easily find the text matching a given regexp before the cursor.

Completion contexts now have `aborted` and `addEventListener(abort, ...)` properties to allow asynchronous completion queries to stop doing work when cancelled.

Completions now support a `detail` property to add some extra text after their label.

Completions can now have a `boost` property to influence the way they are sorted compared to other completions that match the input equally well.

Completions can now have an `info` property that provides extra information to be shown next to the completion when it is selected.

`ChangeSet` now has a `toJSON` method and a static `fromJSON` method to serialize to and deserialize from JSON.

## 0.10.0 (2020-08-11)

### Breaking changes

`LezerSyntax` instances are now created with `LezerSyntax.define` instead of `new LezerSyntax`.

Transaction and change filters are now passed a full transaction as argument.

The `ResolvedTransactionSpec` type is no longer part of the interface.

The `reconfigured` property on transactions has been renamed to `reconfigure`. Similarly, the `scrolledIntoView` property is now called `scrollIntoView`.

Editor state objects no longer have an `indentWithTabs` property.

### Bug fixes

Fix an issue where language data at the end of an unfinished nested grammar at the end of the document would use the outer language instead of the inner.

### New features

A `LezerSyntax` instance can now specify a dialect to parse.

Transactions now have a `newDoc` property that allows you to access the updated document before the new state has been created.

The `indentString` property on editor states can be used to compute an indentation string of a given column width.

The view package now exports an `indentOnInput` extension that enables automatic reindentation when certain patterns are typed at the start of a line. The basic setup enables this.

When the cursor is between matching brackets, `insertNewlineAndIndent` will insert an additional newline after the cursor.

Transaction specs now support a `sequential` property, which causes them to be interpreted in the document space as produced by earlier specs.

## 0.9.0 (2020-07-30)

### Breaking changes

The backspace behavior in the `closebrackets` package is no longer implicitly included in the extension returned by `closeBrackets()`.

### Bug fixes

Fix a crash when running `deleteCharBackward` when the cursor is at the start of the document.

Fix a bug in `Line.slice` that would cause it to loop infinitely on long lines.

Make sure the DOM is reset when `dispatch` fails to update the view.

Fix an issue where double-clicking on a selection in Chrome would leave you with just a cursor, not a selected word.

### New features

Highlighting information for a syntax (as in `styleTags`) can now prefix tag names with `!` to make them override the styling of any child nodes for that syntax node.

It is now possible, when specifying syntax highlighting information, to write rules for a node that apply only when its parent nodes are of a given type. This uses `/` syntax, as in `"Declaration/Identifier": "className"`.

Completion items can now specify a `type` property that determines the icon shown next to them.

`EditorView.inputHandler` can now be used to override the way text input (via the DOM) is handled.

The `closebrackets` package now exports its backspace behavior as a command (`deleteBracketPair`) and a set of bindings that bind it to backspace as `closeBracketsKeymap`.

## 0.8.0 (2020-06-29)

### Breaking changes

`closeBrackets` is now a function, rather than an extension value.

The keymap, special-chars, and multiple-selections packages have been merged into the view package.

The way tooltips are declared changed somewhat to fix an issue with tooltips that stay active across document changes.

Assigning precedences to extension is now done using a plain `precedence` function, rather than a class.

The new state is no longer passed to state field `update` functions (it is part of the transaction anyway now).

The `start` and `end` properties of `Line` have been renamed to `from` and `to` for consistency.

`EditorView.lineAt` is now called `visualLineAt`. Its second argument now defaults to 0.

`EditorView.lineAtHeight` is now called `visualLineAtHeight`.

The `fillConfig` utility is no longer part of the library (the library depends on `Object.assign` now, which provides a standard way to do the same thing).

Completion sources now get all their arguments as properties of the context object.

Language-specific data is now stored in a facet attached to the syntax object, rather than directly in a node prop.

Reconfiguring transactions are now specified in a slightly different way.

### Bug fixes

Fix an issue where the selection was unnecessarily moved to the start of the document when clicking on an unfocused editor.

Work around an issue where sometimes the selection would end in the wrong place on Chrome (because the browser reports a different selection from the one it displays.

Fix an issue where disabling the gutter extension would leave its DOM element in the editor.

### New features

The `EditorView.updateListener` facet can be used to have an external function listening for view updates.

The goto-line package now exports a `gotoLineKeymap` extension.

The new basic-setup package pulls together all the core extensions into a single configuration value.

You can now move through completions with PageUp and PageDown

The editor view now has a [`setState`](https://codemirror.net/6/docs/ref/#view.EditorView.setState) method to reset its state (again).

The autocomplete package now exports functionality for completing to 'snippets' (longer pieces of text with fields that can be filled in one at a time).

`LezerSyntax` instances can now directly specify inherent language data (such as comment syntax).

Language packages now export their supporting extensions (if any) as a separate 'support' value.

Autocompletion can now be configured to ask for case-sensitivity.

Completion results can now specify a `filterDownOn` property to allow the list to be cheaply updated as the user continues typing.

The autocomplete package now exports a `completeFromList` helper to easily construct a completer from a list of options.

`EditorView.dispatch` can now be directly called with transaction specs (rather than always calling `view.state.update` to create its argument).

It is now possible to append extensions from transactions.

Transaction filters can now request the full transaction for the (current) transaction spec if they need it.

## 0.7.1 (2020-06-12)

### Bug fixes

Fix an issue where using Enter during composition would insert a newline.

Fix a problem where the library ignored platform-specific key bindings when building a keymap.

## 0.7.0 (2020-06-11)

### Breaking changes

`EditorView.startMouseSelection` has been replaced with the `EditorView.mouseSelectionStyle` facet, which works somewhat differently.

The `indentUnit` facet now takes a string, rather than a number, and allows a string of tabs to be specified.

The text package no longer exports `isExtendingChar`. Use the new cluster break functions instead.

Text direction is now represented as an enum (`Direction` from the view package) rather than a string.

Selection ranges should be created with `EditorSelection.range` and `EditorSelection.cursor` now, rather than directly calling the constructor.

The by-group selection motion commands like `moveWordLeft` have been renamed to contain 'group' rather than 'word' (`moveGroupLeft`).

`EditorView.movePos` has been removed. Use the new cursor motion methods instead.

The `keyboard` and `pointer` values for `Transaction.userEvent` have been renamed `keyboardselection` and `pointerselection`.

Commands that move the selection are now prefixed with cursor (`cursorCharLeft`), and those that extend the selection are prefixed with select (`selectGroupForward`).

Key bindings are no longer specified as objects, but as arrays of `KeyBinding` specs, one per binding.

Matching delimiters in syntax trees are now registered with `NodeProp.openedBy`/`closedBy` instead of custom props exported from the syntax module.

The lint package's interface was simplified to automatically enable the required extensions when necessary, rather than requiring them to be enabled when configuring the editor.

### Bug fixes

Indentation-related commands will now use tabs to indent when appropriate.

The default key bindings on macOS are now a lot closer to how native editor interfaces behave.

### New features

The editor view now has a `scrollPosIntoView` method to scroll a given document position into view.

Add a new package `rectangular-selection`, which implements rectangle selection on alt-drag.

New `indentWithTabs` getter on the editor state, which indicates whether indentation should use tabs.

The commands package now exports `indentMore` and `indentLess` commands, which unconditionally add/remove indentation on selected lines.

The editor view now has a `bidiSpans` method to retrieve the text order for a given line.

The text package now exports `nextClusterBreak` and `prevClusterBreak`, which can be used to find grapheme cluster breaks in a string.

The new `EditorView` methods `moveByChar`, `moveByGroup`, and `moveToLineBoundary` can be used to compute cursor motion (in a bidi-aware way).

The view method `moveVertically` can now be used to compute vertical cursor motion.

`Line` objects now have a `findClusterBreak` method for more convenient by-cluster motion.

New commands `movePageUp/Down`, `extendPageUp/Down`, `deleteGroupForward/Backward`.

The view class now has a `lineWrapping` property that indicates whether line wrapping is enabled for the editor.

`EditorView.lineWrapping` now holds an extension that enables line wrapping.

Add forward/backward variants of many commands that only support left/right before.

New commands `transposeChars`, `splitLine`, and `deleteToLineEnd` to support macOS's Emacs-style default bindings. New export `emacsStyleBaseKeymap` that contains these and other Emacs-style bindings.

New commands `moveLineBoundaryForward`, `moveLineBoundaryBackward`, `extendLineBoundaryForward`, and `extendLineBoundaryBackward`.

New commands `extendDocStart` and `extendDocEnd`.

When copying or cutting without a selection, the editor will copy or cut by line.

When pasting N lines while the selection has N active ranges, the editor will now paste one line into each range.

The new `EditorState.lineBreak` property gives you the proper line break string for a state.

New commands `moveLineUp/Down` and `copyLineUp/Down`, bound to Alt-ArrowUp/Down and Shift-Alt-ArrowUp/Down by default.

New command `deleteLine`, bound to Shift-Mod-k by default.

New commands `cursorMatchingBracket` and `selectMatchingBracket`.

It is now possible to customize the DOM element that editor panels are placed into.

The `panel` extension now has a `getPanel` accessor to retrieve the panel created by a given constructor function.

New command `nextLintDiagnostic` to jump to the next linter message.

The new `selectParentSyntax` command selects the syntax node around the selection.

New commands `cursor`/`selectSyntaxLeft`/`Right` to jump over tokens or bracketed syntactic constructs.

New commands `foldAll` and `unfoldAll`.

The fold package now exports a default keymap `foldKeymap`

The comment package now exports a `commentKeymap` binding.

New command `selectLine`.

The new `highlightActiveLine` extension can be used to style lines with a cursor on them.

New extension `highlightSelectionMatches`, which enables highlighting of text that matches the current selection.

When defining a highlighter, it is now possible to assign a style to multiple tags by separating them by commas in the property name.

New theme package: theme-one-dark.

Key bindings may now involve multiple key strokes (specified as a space-separated string of key names).

Key bindings that include a `preventDefault` property will now cause the key event to be stopped even when the bound command(s) return false.

New command: `deleteTrailingWhitespace`.

New command `selectSelectionMatches` that selects all instances of the currently selected string.

You can now pass a `parent` option to a view to append it to the DOM right away.

## 0.6.0 (2020-05-13)

### New features

There is now a `comment` package with commenting/uncommenting commands.

The new `collab` package implements a framework for collaborative editing.

When creating or updating a state, the selection may now be specified as an `{anchor, head?}` object literal.

There are new methods `toText` and `sliceDoc` on the editor state for working with strings.

Some methods that used to be part of `Transaction` now have an equivalent on the state object. `replaceSelection` moved there. `changeByRange` replaces `Transaction.forEachRange`. And `changes` can be used to build up a changeset.

### Breaking changes

The `Text` class interface changed to make better use of its own abstraction. `replace` takes a `Text` instance instead of an array of strings, `slice` now returns a `Text`, and there's a new `append` method.

The representation of changes and change sets has been redone. Instead of storing a sequence of change objects, change sets are now a flat map of the locations in the document that changed.

The way transactions work has changed. They are now immutable objects created with `EditorState.update`.

Transaction filtering works differently now. See the `changeFilter` and `transactionFilter` facets.

What used to be extension groups is now called tagged extensions (using the `tagExtension` function).

`mapPos` now returns -1 to indicate deletion (when the map mode asks for this).

## 0.5.2 (2020-04-09)

### Bug fixes

Fix an issue where external TypeScript builds would try to recompile the library code.

## 0.5.1 (2020-04-08)

### Bug fixes

Include the TypeScript declaration files in the npm package.

## 0.5.0 (2020-04-01)

### Breaking changes

`EditorView.domEventHandlers` is now a function, and the handlers receive their arguments in a different order.

Syntax objects no longer have a `languageDataAt` method (this was moved to `EditorState`, and changed somewhat).

Completion functions now return a plain list of results, rather than an object.

The interface to `EditorState.indentation` changed, taking an `IndentContext` object.

Facets provided by a state field are now declared in an option to `StateField.define`, instead of in method calls on the field object.

Isolating transactions so that they become their own undo history item is now done with the `isolateHistory` annotation.

The packages are no longer available as CommonJS files. To run the code on node.js, you'll need node 13 or pass `--experimental-modules` to node 12.

### New features

View plugins now have an `eventHandlers` method to attach plugin-specific DOM event handlers.

The editor state now has a `languageDataAt` that collects values stored under a given property name in the main language data and in object attached for a given document type with the `addLanguageData` facet.

It is now possible to provide indentation functions with information about already-reindented lines through an `IndentContext` object, making it possible to reindent a region in one go without re-parsing.

Lint sources can now be asynchronous.

The `EditorView.editable` facet can now be used to control whether the content is editable.

The [`selectionFilter`](https://codemirror.net/6/docs/ref/#state.EditorState^selectionFilter) facet can now be used to control selection updates.

The new [`changeFilter`](https://codemirror.net/6/docs/ref/#state.EditorState^changeFilter) facet can be used to stop or modify document changes.

[`Transaction.change`](https://codemirror.net/6/docs/ref/#state.Transaction.change) now also accepts an array of changes to apply in one go.

The history module now exports a facet that allows you to create inverted effects from a transaction, which will be stored in the history. (This allows making non-document state un/redoable.)

Transactions can now contains [state effects](https://codemirror.net/6/docs/ref/#state.StateEffect), which can describe state changes for extensions, and be [integrated](https://codemirror.net/6/docs/ref/#history.invertedEffects) with the undo history.

Transactions now have a `mapRef` method to easily create a position mapping from a given intermediate document to the current document.

## 0.4.0 (2020-02-21)

### Breaking Changes

Behavior was renamed to [`Facet`](https://codemirror.net/6/docs/ref/#state.Facet), and works somewhat differently.

The `extension` package no longer exists. Extension-related concepts are now part of the `state` package.

The view no longer has its own extension system. It is entirely configured by state extensions.

[View plugins](https://codemirror.net/6/docs/ref/#view.ViewPlugin) are specified through a state facet now, and have a simpler interface.

View plugins may no longer create decorations that significantly impact the height of content, to avoid the cyclic dependency between plugin decorations and the viewport.

[Themes](https://codemirror.net/6/docs/ref/#view.EditorView^theme) work differently now, using [static CSS classes](https://codemirror.net/6/docs/ref/#view.themeClass) on DOM elements so that plugins don't have to update their DOM when the editor theme changes.

Highlighting token types now support a numeric suffix, which replaces the old `typeN` modifiers.

The interface to [syntax extensions](https://codemirror.net/6/docs/ref/#state.Syntax) and [parse trees](https://codemirror.net/6/docs/ref/#state.EditorState.tree) changed.

The way transaction [annotations](https://codemirror.net/6/docs/ref/#state.Annotation) work was simplified a bit.

[Range sets](https://codemirror.net/6/docs/ref/#rangeset) were rewritten and support a somewhat different interface now.

The way [decorations](https://codemirror.net/6/docs/ref/#view.Decoration) are created now separates the creation of the decoration value from the creation of the range to which it should apply.

### New features

State facets can provide [decorations](https://codemirror.net/6/docs/ref/#view.EditorView^decorations) now.

Reading DOM layout information and similar things is now done with the [`requestMeasure`](https://codemirror.net/6/docs/ref/#view.EditorView.requestMeasure) method.

Facets now explicitly track which fields and other facets they depend on, so that they are recomputed only when necessary.

Any object that has an `extension` property that holds an extension value may now be used as an extension.

Overlong lines that are inside the viewport will now be partially hidden to speed up rendering and interaction.

The editor view now has a [`textDirection`](https://codemirror.net/6/docs/ref/#view.EditorView.textDirection) property telling you whether the main writing direction is left-to-right or right-to-left.

There's now a [`visibleRanges`](https://codemirror.net/6/docs/ref/#view.EditorView.visibleRanges) property that tells you which part of the viewport is actually going to be drawn, speeding up things like highlighting when there's large amounts of collapsed code in the viewport.

### Bug fixes

Fix issue where mouse dragging would create selections with the the anchor and head reversed.

Make code folding behave better when the folded node doesn't start on the same line as the actual fold.

Fix a number of issues that would make parsing big files slow (or even lock up entirely).

## 0.3.0 (2019-11-29)

### Breaking changes

Language-wide configuration is no longer stored in per-extension node props, but in a single `languageData` object held in a prop defined in the state package. The `Syntax` method `languageDataAt` is used to read it.

Unique extensions no longer exist. Instead, extensions are deduplicated by identity. Merging configurations for an extension should now be done in a behavior.

### Bug fixes

Fix issue where starting with an empty editor would break height estimates.

Fix an issue where widgets at the end of a line could stay around after being deleted in some cases.

Fix rendering of lines that are empty except for a widget.

### New features

A plugin's `drawMeasured` method may now return true to request another measure/draw cycle.

The editor view now has a `requireMeasure` method to schedule a layout check that'll allow plugins to measure and update the DOM.

The state package now re-exports the `Text` type.

Add an adaptor for connecting ESLint output to the CodeMirror linter package to the lang-javascript package.

The [`tooltip`](https://codemirror.net/6/docs/ref/#tooltip) package provides a way to show tooltip over the editor.

The new [`autocomplete`](https://codemirror.net/6/docs/ref/#autocomplete) package implements an autocompletion interface.

The new [`lint`](https://codemirror.net/6/docs/ref/#lint) package integrates linting with the editor by underlining issues and providing a list of problems that you can scroll through.

The `lang-javascript` package now exports an [`esLint`](https://codemirror.net/6/docs/ref/#lang-javascript.esLint) function that can be used to wire up [ESLint](https://eslint.org/) to the CodeMirror lint integration.

## 0.2.0 (2019-10-28)

### Breaking changes

`syntaxIndentation` no longer has to be registered separately as an extension. It is now implied when registering a tree syntax.

The configuration passed to `gutter` no longer takes direct class names, but a `style` option that determines the theme fields used for the gutter.

`ViewPlugin` instances are now created with a static `create` method, instead of the constructor.

Declaring custom gutters is now done with a `Gutter` constructor.

Configuring whether the gutters are fixed is now done with the `gutters` extension, rather than per individual gutter.

There is now an additional wrapper element around the editor (`EditorView.scrollDOM`), which is the element that should be targeted with `overflow` style properties.

`EditorView.cssClass` no longer accepts space-separated lists of classes.

`Slot` from the extension package has been replaced with `Annotation` in the state package. Transaction metadata is now called annotations, and the method names have been updated accordingly.

`Command` from state was renamed to `StateCommand`, `ViewCommand` from view is now called `Command`.

### Bug fixes

Fix a bug where a behavior's `combine` method wasn't called when the behavior was entirely static.

Fix issue that caused nested replaced decorations to be drawn incorrectly.

`ViewUpdate.themeChanged` no longer returns the inverse of what it should be returning.

Avoid crash on Firefox when focusing the editor if another form field has focus.

Fixes a bug where changes near replacing decorations would corrupt the editor's view of its height layout.

### New features

The new `EditorState.foldable` behavior provides a way to register code folding services.

Lezer syntax can now register code folding metadata on tree nodes via `foldNodeProp`.

There is now a fold package with code folding commands (which need the `codeFolding` extension to be active to work).

`EditorView.posFromDOM` can now be used to find the document position of a given DOM position.

Gutters can now be themed.

`ViewPlugin` instances can be extended with dynamic behavior using their `behavior` and `decorations` methods.

Gutters can now be passed a `handleDOMEvents` option that allows client code to register event handlers on them.

You can now iterate over a `RangeSet` more cheaply with an (internal) iterator using the `between` method.

Syntax services now have a `docTypeAt` method that gives you the grammar node around the given point (which may be part of a nesting grammar).

The text package now has replacements for `codePointAt` and `fromCodePoint`.

Added a bracket-closing extension in the `closebrackets` package.

Adds a panel package that contains functionality for showing UI panels at the top or bottom of the editor.

The new search package provides search/replace-related functionality.

Themes and `EditorView.cssClass` can now target dot-separated more specific versions of a name.

The `phrase` method on the editor view can now be used to access translation provided with the `EditorView.phrases` behavior.

Widget `toDOM` methods are now passed the editor view.

Add `EditorView.scrollMargins` behavior, which can be used to make the view scroll past regions at the side of the editor when scrolling something into view.

The keymap package now exports a `NormalizedKeymap` class that can be used to build key handlers on other elements.

## 0.1.0 (2019-10-10)

### Breaking Changes

First numbered release.
