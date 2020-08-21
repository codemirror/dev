import {tooltips} from "@codemirror/next/tooltip"
import {precedence, Extension, EditorState} from "@codemirror/next/state"
import {keymap} from "@codemirror/next/view"
import {AutocompleteContext, Completion, Autocompleter} from "./completion"
import {completionState, autocompleteConfig, AutocompleteConfig, State} from "./state"
import {autocompletePlugin, moveCompletion, acceptCompletion} from "./view"
import {SnippetSpec, snippet} from "./snippet"
import {baseTheme} from "./theme"

export {snippet, SnippetSpec} from "./snippet"
export {Completion, AutocompleteContext, Autocompleter, CompletionResult} from "./completion"
export {startCompletion, closeCompletion, autocompleteKeymap} from "./view"

/// Returns an extension that enables autocompletion.
export function autocomplete(config: AutocompleteConfig = {}): Extension {
  return [
    completionState,
    autocompleteConfig.of(config),
    autocompletePlugin,
    baseTheme,
    tooltips(),
    precedence(keymap([
      {key: "ArrowDown", run: moveCompletion("down")},
      {key: "ArrowUp", run: moveCompletion("up")},
      {key: "PageDown", run: moveCompletion("down", "page")},
      {key: "PageUp", run: moveCompletion("up", "page")},
      {key: "Enter", run: acceptCompletion}
    ]), "override")
  ]
}

function toSet(chars: {[ch: string]: true}) {
  let flat = Object.keys(chars).join("")
  let words = /\w/.test(flat)
  if (words) flat = flat.replace(/\w/g, "")
  return `[${words ? "\\w" : ""}${flat.replace(/[^\w\s]/g, "\\$&")}]`
}

function prefixMatch(options: readonly Completion[]) {
  let first = Object.create(null), rest = Object.create(null)
  for (let {label} of options) {
    first[label[0]] = true
    for (let i = 1; i < label.length; i++) rest[label[i]] = true
  }
  let source = toSet(first) + toSet(rest) + "*$"
  return [new RegExp("^" + source), new RegExp(source)]
}

/// Given a a fixed array of options, return an autocompleter that
/// compares those options to the current
/// [token](#autocomplete.AutocompleteContext.tokenBefore) and returns
/// the matching ones.
export function completeFromList(list: readonly (string | Completion)[]): Autocompleter {
  let options = list.map(o => typeof o == "string" ? {label: o} : o) as Completion[]
  let [span, match] = options.every(o => /^\w+$/.test(o.label)) ? [/\w*$/, /\w+$/] : prefixMatch(options)
  return (context: AutocompleteContext) => {
    let token = context.matchBefore(match)
    return token || context.explicit ? {from: token ? token.from : context.pos, options, span} : null
  }
}

/// Create a completion source from an array of snippet specs.
export function completeSnippets(snippets: readonly SnippetSpec[]): Autocompleter {
  return completeFromList(snippets.map(s => ({label: s.keyword, detail: s.detail, apply: snippet(s.snippet)})))
}

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
