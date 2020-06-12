import {keymap, highlightSpecialChars, multipleSelections} from "@codemirror/next/view"
import {Extension} from "@codemirror/next/state"
import {history, historyKeymap} from "@codemirror/next/history"
import {foldGutter, foldKeymap} from "@codemirror/next/fold"
import {lineNumbers} from "@codemirror/next/gutter"
import {defaultKeymap} from "@codemirror/next/commands"
import {bracketMatching} from "@codemirror/next/matchbrackets"
import {closeBrackets} from "@codemirror/next/closebrackets"
import {searchKeymap} from "@codemirror/next/search"
import {autocomplete, autocompleteKeymap} from "@codemirror/next/autocomplete"
import {commentKeymap} from "@codemirror/next/comment"
import {rectangularSelection} from "@codemirror/next/rectangular-selection"
import {gotoLineKeymap} from "@codemirror/next/goto-line"
import {highlightActiveLine, highlightSelectionMatches} from "@codemirror/next/highlight-selection"
import {defaultHighlighter} from "@codemirror/next/highlight"
import {lintKeymap} from "@codemirror/next/lint"

/// This is an extension value that just pulls together a whole lot of
/// extensions that you might want in a basic editor. It is meant as a
/// convenient helper to quickly set up CodeMirror without installing
/// and importing a lot of packages.
///
/// Specifically, it includes...
///
///  - [the default command bindings](#commands.defaultKeymap)
///  - [line numbers](#gutter.lineNumbers)
///  - [special character highlighting](#view.highlightSpecialChars)
///  - [the undo history](#history.history)
///  - [a fold gutter](#fold.foldGutter)
///  - [multiple selection support](#view.multipleSelections)
///  - [the default highlighter](#highlight.defaultHighlighter)
///  - [bracket matching](#matchbrackets.bracketMatching)
///  - [bracket closing](#closebrackets.closeBrackets)
///  - [autocompletion](#autocomplete.autocomplete)
///  - [rectangular selection](#rectangular-selection.rectangularSelection)
///  - [active line highlighting](#highlight-selection.highlightActiveLine)
///  - [selection match highlighting](#highlight-selection.highlightSelectionMatches)
///  - [search](#search.searchKeymap)
///  - [go to line](#goto-line.gotoLineKeymap)
///  - [commenting](#comment.commentKeymap)
///  - [linting](#lint.lintKeymap)
///
/// (You'll probably want to add some language package to your setup
/// too.)
///
/// This package does not allow customization. The idea is that, once
/// you decide you want to configure your editor more precisely, you
/// take this package's source (which is just a bunch of imports and
/// an array literal), copy it into your own code, and adjust it as
/// desired.
export const basicSetup: Extension = [
  lineNumbers(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  multipleSelections(),
  defaultHighlighter,
  bracketMatching(),
  closeBrackets(),
  autocomplete(),
  rectangularSelection(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap([
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...commentKeymap,
    ...gotoLineKeymap,
    ...autocompleteKeymap,
    ...lintKeymap
  ])
]

export {EditorView} from "@codemirror/next/view"
export {EditorState} from "@codemirror/next/state"
