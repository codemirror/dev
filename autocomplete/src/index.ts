import {tooltips} from "@codemirror/next/tooltip"
import {precedence, Extension, EditorState} from "@codemirror/next/state"
import {syntaxTree} from "@codemirror/next/language"
import {keymap, KeyBinding} from "@codemirror/next/view"
import {SyntaxNode} from "lezer-tree"
import {CompletionContext, Completion, CompletionSource} from "./completion"
import {completionState, State} from "./state"
import {CompletionConfig, completionConfig} from "./config"
import {completionPlugin, moveCompletionSelection, acceptCompletion, startCompletion, closeCompletion} from "./view"
import {baseTheme} from "./theme"

export {snippet, snippetCompletion} from "./snippet"
export {Completion, CompletionContext, CompletionSource, CompletionResult} from "./completion"
export {startCompletion, closeCompletion, acceptCompletion, moveCompletionSelection} from "./view"

/// Returns an extension that enables autocompletion.
export function autocompletion(config: CompletionConfig = {}): Extension {
  return [
    completionState,
    completionConfig.of(config),
    completionPlugin,
    baseTheme,
    tooltips(),
    precedence(keymap([
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
/// [token](#autocomplete.CompletionContext.tokenBefore) and returns
/// the matching ones.
export function completeFromList(list: readonly (string | Completion)[]): CompletionSource {
  let options = list.map(o => typeof o == "string" ? {label: o} : o) as Completion[]
  let [span, match] = options.every(o => /^\w+$/.test(o.label)) ? [/\w*$/, /\w+$/] : prefixMatch(options)
  return (context: CompletionContext) => {
    let token = context.matchBefore(match)
    return token || context.explicit ? {from: token ? token.from : context.pos, options, span} : null
  }
}

/// Wrap the given completion source so that it will not fire when the
/// cursor is in a syntax node with one of the given names.
export function ifNotIn(nodes: readonly string[], source: CompletionSource) {
  return (context: CompletionContext) => {
    for (let pos: SyntaxNode | null = syntaxTree(context.state).resolve(context.pos, -1); pos; pos = pos.parent)
      if (nodes.indexOf(pos.name) > -1) return null
    return source(context)
  }
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
