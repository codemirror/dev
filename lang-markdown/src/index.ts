import {Extension, precedence} from "@codemirror/next/state"
import {KeyBinding, keymap} from "@codemirror/next/view"
import {markdownLanguage} from "./markdown"
import {insertNewlineContinueMarkup, deleteMarkupBackward} from "./commands"
export {markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward}

/// A small keymap with Markdown-specific bindings. Binds Enter to
/// [`insertNewlineContinueMarkup`](#lang-markdown.insertNewlineContinueMarkup)
/// and Backspace to
/// [`deleteMarkupBackward`](#commands.deleteMarkupBackward).
export const markdownKeymap: readonly KeyBinding[] = [
  {key: "Enter", run: insertNewlineContinueMarkup},
  {key: "Backspace", run: deleteMarkupBackward}
]


/// Provides the Markdown [keymap](#lang-markdown.markdownKeymap)
/// (with `extend` [precedence](#state.precedence)).
export function markdownSupport(): Extension {
  return precedence(keymap(markdownKeymap), "extend")
}

/// Returns an extension that installs the Markdown language and
/// support.
export function markdown(): Extension {
  return [markdownLanguage, ]
}
