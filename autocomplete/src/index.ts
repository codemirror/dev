import {tooltips} from "@codemirror/next/tooltip"
import {precedence, Extension, EditorState} from "@codemirror/next/state"
import {keymap, KeyBinding} from "@codemirror/next/view"
import {Completion} from "./completion"
import {completionState, State} from "./state"
import {CompletionConfig, completionConfig} from "./config"
import {completionPlugin, moveCompletionSelection, acceptCompletion, startCompletion, closeCompletion} from "./view"
import {baseTheme} from "./theme"

export {snippet, snippetCompletion, nextSnippetField, prevSnippetField, clearSnippet, snippetKeymap} from "./snippet"
export {Completion, CompletionContext, CompletionSource, CompletionResult, completeFromList, ifNotIn} from "./completion"
export {startCompletion, closeCompletion, acceptCompletion, moveCompletionSelection} from "./view"
export {completeAnyWord} from "./word"

/// Returns an extension that enables autocompletion.
export function autocompletion(config: CompletionConfig = {}): Extension {
  return [
    completionState,
    completionConfig.of(config),
    completionPlugin,
    baseTheme,
    tooltips(),
    precedence(keymap.of([
      {key: "ArrowDown", run: moveCompletionSelection(true)},
      {key: "ArrowUp", run: moveCompletionSelection(false)},
      {key: "PageDown", run: moveCompletionSelection(true, "page")},
      {key: "PageUp", run: moveCompletionSelection(false, "page")},
      {key: "Enter", run: acceptCompletion}
    ]), "override")
  ]
}

/// Basic keybindings for autocompletion.
///
///  - Ctrl-Space (Cmd-Space on macOS): [`startCompletion`](#autocomplete.startCompletion)
///  - Escape: [`closeCompletion`](#autocomplete.closeCompletion)
export const completionKeymap: readonly KeyBinding[] = [
  {key: "Mod-Space", run: startCompletion},
  {key: "Escape", run: closeCompletion}
]

/// Get the current completion status. When completions are available,
/// this will return `"active"`. When completions are pending (in the
/// process of being queried), this returns `"pending"`. Otherwise, it
/// returns `null`.
export function completionStatus(state: EditorState): null | "active" | "pending" {
  let cState = state.field(completionState, false)
  return cState && cState.active.some(a => a.state == State.Pending) ? "pending"
    : cState && cState.active.some(a => a.state != State.Inactive) ? "active" : null
}

/// Returns the available completions as an array.
export function currentCompletions(state: EditorState): readonly Completion[] {
  let open = state.field(completionState, false)?.open
  return open ? open.options.map(o => o.completion) : []
}
