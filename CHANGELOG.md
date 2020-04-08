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
