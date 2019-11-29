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
