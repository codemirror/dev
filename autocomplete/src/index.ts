import {ViewPlugin, PluginValue, ViewUpdate, EditorView, logException, Command, themeClass} from "@codemirror/next/view"
import {combineConfig, Transaction, Extension, StateField, StateEffect, Facet, precedence,
        EditorState, ChangeDesc} from "@codemirror/next/state"
import {Tooltip, TooltipView, tooltips, showTooltip} from "@codemirror/next/tooltip"
import {keymap, KeyBinding} from "@codemirror/next/view"
import {Subtree} from "lezer-tree"
import {baseTheme} from "./theme"
import {FuzzyMatcher} from "./filter"
import {snippet, SnippetSpec} from "./snippet"
export {snippet, SnippetSpec}

function cur(state: EditorState) { return state.selection.primary.head }

/// Objects type used to represent individual completions.
export interface Completion {
  /// The label to show in the completion picker. This is what input
  /// is matched agains to determine whether a completion matches (and
  /// how well it matches).
  label: string,
  /// How to apply the completion. When this holds a string, the
  /// completion range is replaced by that string. When it is a
  /// function, that function is called to perform the completion.
  apply?: string | ((view: EditorView, completion: Completion, from: number, to: number) => void),
  /// The type of the completion. This is used to pick an icon to show
  /// for the completion. Icons are styled with a theme selector
  /// created by appending the given type name to `"completionIcon."`.
  /// You can define or restyle icons by defining these selectors. The
  /// base library defines simple icons for `class`, `constant`,
  /// `enum`, `function`, `interface`, `keyword`, `method`,
  /// `namespace`, `property`, `text`, `type`, and `variable`.
  type?: string
}

/// An instance of this is passed to completion source functions.
export class AutocompleteContext {
  /// @internal
  constructor(
    /// The editor state that the completion happens in.
    readonly state: EditorState,
    /// The position at which the completion happens.
    readonly pos: number,
    /// Indicates whether completion was activated explicitly, or
    /// implicitly by typing. The usual way to respond to this is to
    /// only return completions when either there is part of a
    /// completable entity at the cursor, or explicit is true.
    readonly explicit: boolean
  ) {}

  /// Get the extent, content, and (if there is a token) type of the
  /// token before `this.pos`.
  tokenBefore(types: readonly string[]) {
    let token: Subtree | null = this.state.tree.resolve(this.pos, -1)
    while (token && types.indexOf(token.name) < 0) token = token.parent
    return token ? {from: token.start, to: this.pos,
                    text: this.state.sliceDoc(token.start, this.pos),
                    type: token.type} : null
  }

  /// Get the match of the given expression directly before the
  /// cursor.
  matchBefore(expr: RegExp) {
    let line = this.state.doc.lineAt(this.pos)
    let start = Math.max(line.from, this.pos - 250)
    let str = line.slice(start - line.from, this.pos - line.from)
    let found = str.search(ensureAnchor(expr, false))
    return found < 0 ? null : {from: start + found, to: this.pos, text: str.slice(found)}
  }
}

function ensureAnchor(expr: RegExp, start: boolean) {
  let {source} = expr
  let addStart = start && source[0] != "^", addEnd = source[source.length - 1] != "$"
  if (!addStart && !addEnd) return expr
  return new RegExp(`${addStart ? "^" : ""}(?:${source})${addEnd ? "$" : ""}`,
                    expr.flags ?? (expr.ignoreCase ? "i" : ""))
}

/// The function signature for a completion source. Such a function
/// may return its [result](#autocomplete.CompletionResult)
/// synchronously or as a promise. Returning null indicates no
/// completions are available.
export type Autocompleter =
  (context: AutocompleteContext) => CompletionResult | null | Promise<CompletionResult | null>

/// Interface for objects returned by completion sources.
export interface CompletionResult {
  /// The start of the range that is being completed.
  from: number,
  /// The end of the range that is being completed. Defaults to the
  /// primary cursor position.
  to?: number,
  /// The completions
  options: readonly Completion[],
  /// When given, further input that causes the part of the document
  /// between (mapped) `from` and `to` to match this regular
  /// expression will not query the completion source again, but
  /// continue with this list of options. This can help a lot with
  /// responsiveness, since it allows the completion list to be
  /// updated synchronously.
  span?: RegExp
}

const MaxOptions = 300

function sortOptions(active: readonly ActiveSource[], state: EditorState) {
  let options = []
  for (let a of active) if (a.hasResult()) {
    let matcher = new FuzzyMatcher(state.sliceDoc(a.from, a.to)), match
    for (let option of a.result.options) if (match = matcher.match(option.label)) {
      options.push(new Option(option, a, match))
    }
  }
  options.sort(cmpOption)
  return options.length > MaxOptions ? options.slice(0, MaxOptions) : options
}

class CompletionDialog {
  constructor(readonly options: readonly Option[],
              readonly attrs: {[name: string]: string},
              readonly tooltip: readonly Tooltip[],
              readonly timestamp: number,
              readonly selected: number) {}

  setSelected(selected: number, id: string) {
    return selected == this.selected || selected >= this.options.length ? this
      : new CompletionDialog(this.options, makeAttrs(id, selected), this.tooltip, this.timestamp, selected)
  }

  static build(active: readonly ActiveSource[], state: EditorState, id: string, prev: CompletionDialog | null) {
    let options = sortOptions(active, state)
    if (!options.length) return null
    let selected = 0
    if (prev) {
      let selectedValue = prev.options[prev.selected].completion
      for (let i = 0; i < options.length && !selected; i++) {
        if (options[i].completion == selectedValue) selected = i
      }
    }
    return new CompletionDialog(options, makeAttrs(id, selected), [{
      pos: active.reduce((a, b) => b.hasResult() ? Math.min(a, b.from) : a, 1e8),
      style: "autocomplete",
      create: completionTooltip(options, id)
    }], prev ? prev.timestamp : Date.now(), selected)
  }
}

class CompletionState {
  constructor(readonly active: readonly ActiveSource[],
              readonly id: string,
              readonly open: CompletionDialog | null) {}

  static start() {
    return new CompletionState(none, "cm-ac-" + Math.floor(Math.random() * 2e6).toString(36), null)
  }

  update(tr: Transaction) {
    let {state} = tr, conf = state.facet(autocompleteConfig)
    let sources = conf.override || state.languageDataAt<Autocompleter>("autocomplete", cur(state))
    let active: readonly ActiveSource[] = sources.map(source => {
      let value = this.active.find(s => s.source == source) || new ActiveSource(source, State.Inactive, false)
      return value.update(tr)
    })
    if (active.length == this.active.length && active.every((a, i) => a == this.active[i])) active = this.active

    let open = tr.selection || active.some(a => a.hasResult() && tr.changes.touchesRange(a.from, a.to)) ||
      !sameResults(active, this.active) ? CompletionDialog.build(active, state, this.id, this.open) : this.open
    for (let effect of tr.effects) if (effect.is(setSelectedEffect)) open = open && open.setSelected(effect.value, this.id)

    return active == this.active && open == this.open ? this : new CompletionState(active, this.id, open)
  }

  get tooltip(): readonly Tooltip[] { return this.open ? this.open.tooltip : none }

  get attrs() { return this.open ? this.open.attrs : baseAttrs }
}

function sameResults(a: readonly ActiveSource[], b: readonly ActiveSource[]) {
  if (a == b) return true
  for (let iA = 0, iB = 0;;) {
    while (iA < a.length && !a[iA].hasResult) iA++
    while (iB < b.length && !b[iB].hasResult) iB++
    let endA = iA == a.length, endB = iB == b.length
    if (endA || endB) return endA == endB
    if ((a[iA++] as ActiveResult).result != (b[iB++] as ActiveResult).result) return false
  }
}

function makeAttrs(id: string, selected: number): {[name: string]: string} {
  return {
    "aria-autocomplete": "list",
    "aria-activedescendant": id + "-" + selected,
    "aria-owns": id
  }
}

const baseAttrs = {"aria-autocomplete": "list"}, none: readonly any[] = []

function cmpOption(a: Option, b: Option) {
  let dScore = b.match[0] - a.match[0]
  if (dScore) return dScore
  let lA = a.completion.label, lB = b.completion.label
  return lA < lB ? -1 : lA == lB ? 0 : 1
}

const enum State { Inactive = 0, Pending = 1, Result = 2 }

class ActiveSource {
  constructor(readonly source: Autocompleter,
              readonly state: State,
              readonly explicit: boolean) {}

  hasResult(): this is ActiveResult { return false }

  update(tr: Transaction): ActiveSource {
    let event = tr.annotation(Transaction.userEvent), value: ActiveSource = this
    if (event == "input" || event == "delete")
      value = value.handleUserEvent(tr, event)
    else if (tr.docChanged)
      value = value.handleChange(tr)
    else if (tr.selection && value.state != State.Inactive)
      value = new ActiveSource(value.source, State.Inactive, false)

    for (let effect of tr.effects) {
      if (effect.is(toggleCompletionEffect)) {
        value = effect.value ? new ActiveSource(value.source, State.Pending, true)
          : new ActiveSource(value.source, State.Inactive, false)
      } else if (effect.is(setActiveEffect)) {
        for (let active of effect.value) if (active.source == value.source) value = active
      }
    }
    return value
  }

  handleUserEvent(_tr: Transaction, type: "input" | "delete"): ActiveSource {
    return type == "delete" ? this : new ActiveSource(this.source, State.Pending, false)
  }

  handleChange(tr: Transaction): ActiveSource {
    return tr.changes.touchesRange(cur(tr.startState)) ? new ActiveSource(this.source, State.Inactive, false) : this
  }
}

class ActiveResult extends ActiveSource {
  constructor(source: Autocompleter,
              explicit: boolean,
              readonly result: CompletionResult,
              readonly from: number,
              readonly to: number,
              readonly span: RegExp | null) {
    super(source, State.Result, explicit)
  }

  hasResult(): this is ActiveResult { return true }

  handleUserEvent(tr: Transaction, type: "input" | "delete"): ActiveSource {
    let from = tr.changes.mapPos(this.from), to = tr.changes.mapPos(this.to, 1)
    let pos = cur(tr.state)
    if ((this.explicit ? pos < from : pos <= from) || pos > to)
      return new ActiveSource(this.source, type == "input" ? State.Pending : State.Inactive, false)
    if (this.span && (from == to || this.span.test(tr.state.sliceDoc(from, to))))
      return new ActiveResult(this.source, this.explicit, this.result, from, to, this.span)
    return new ActiveSource(this.source, State.Pending, this.explicit)
  }

  handleChange(tr: Transaction): ActiveSource {
    return tr.changes.touchesRange(this.from, this.to)
      ? new ActiveSource(this.source, State.Inactive, false)
      : new ActiveResult(this.source, this.explicit, this.result,
                         tr.changes.mapPos(this.from), tr.changes.mapPos(this.to, 1), this.span)
  }

  map(mapping: ChangeDesc) {
    return new ActiveResult(this.source, this.explicit, this.result,
                            mapping.mapPos(this.from), mapping.mapPos(this.to, 1), this.span)
  }
}

interface AutocompleteConfig {
  /// When enabled (defaults to true), autocompletion will start
  /// whenever the user types something that can be completed.
  activateOnTyping?: boolean
  /// Override the completion sources used.
  override?: readonly Autocompleter[] | null
}

class Option {
  constructor(readonly completion: Completion,
              readonly source: ActiveResult,
              readonly match: readonly number[]) {}
}

const autocompleteConfig = Facet.define<AutocompleteConfig, Required<AutocompleteConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      activateOnTyping: true,
      override: null
    })
  }
})

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

const CompletionInteractMargin = 75

function moveCompletion(dir: string, by?: string) {
  return (view: EditorView) => {
    let cState = view.state.field(completionState)
    if (!cState.open || Date.now() - cState.open.timestamp < CompletionInteractMargin) return false
    let step = 1, tooltip
    if (by == "page" && (tooltip = view.dom.querySelector(".cm-tooltip-autocomplete") as HTMLElement))
      step = Math.max(2, Math.floor(tooltip.offsetHeight / (tooltip.firstChild as HTMLElement).offsetHeight))
    let selected = cState.open.selected + step * (dir == "up" ? -1 : 1), {length} = cState.open.options
    if (selected < 0) selected = by == "page" ? 0 : length - 1
    else if (selected >= length) selected = by == "page" ? length - 1 : 0
    view.dispatch({effects: setSelectedEffect.of(selected)})
    return true
  }
}

function acceptCompletion(view: EditorView) {
  let cState = view.state.field(completionState)
  if (!cState.open || Date.now() - cState.open.timestamp < CompletionInteractMargin) return false
  applyCompletion(view, cState.open.options[cState.open.selected])
  return true
}

/// Explicitly start autocompletion.
export const startCompletion: Command = (view: EditorView) => {
  let cState = view.state.field(completionState, false)
  if (!cState) return false
  view.dispatch({effects: toggleCompletionEffect.of(true)})
  return true
}

function applyCompletion(view: EditorView, option: Option) {
  let apply = option.completion.apply || option.completion.label
  let result = option.source
  if (typeof apply == "string") {
    view.dispatch({
      changes: {from: result.from, to: result.to, insert: apply},
      selection: {anchor: result.from + apply.length}
    })
  } else {
    apply(view, option.completion, result.from, result.to)
  }
}

/// Close the currently active completion.
export const closeCompletion: Command = (view: EditorView) => {
  let cState = view.state.field(completionState, false)
  if (!cState || !cState.active.some(a => a.state != State.Inactive)) return false
  view.dispatch({effects: toggleCompletionEffect.of(false)})
  return true
}

/// Basic keybindings for autocompletion.
///
///  - Ctrl-Space (Cmd-Space on macOS): [`startCompletion`](#autocomplete.startCompletion)
///  - Escape: [`closeCompletion`](#autocomplete.closeCompletion)
export const autocompleteKeymap: readonly KeyBinding[] = [
  {key: "Mod-Space", run: startCompletion},
  {key: "Escape", run: closeCompletion}
]

const toggleCompletionEffect = StateEffect.define<boolean>()
const setActiveEffect = StateEffect.define<readonly ActiveSource[]>({
  map(sources, mapping) { return sources.map(s => s.hasResult() && !mapping.empty ? s.map(mapping) : s) }
})
const setSelectedEffect = StateEffect.define<number>()

const completionState = StateField.define<CompletionState>({
  create() { return CompletionState.start() },

  update(value, tr) { return value.update(tr) },

  provide: [
    showTooltip.nFrom(state => state.tooltip),
    EditorView.contentAttributes.from(state => state.attrs)
  ]
})

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
  return open ? open.options.map(o => o.completion) : none
}

function createListBox(options: readonly Option[], id: string) {
  const ul = document.createElement("ul")
  ul.id = id
  ul.setAttribute("role", "listbox")
  ul.setAttribute("aria-expanded", "true")
  for (let i = 0; i < options.length; i++) {
    let {completion, match} = options[i]
    const li = ul.appendChild(document.createElement("li"))
    li.id = id + "-" + i
    let icon = li.appendChild(document.createElement("div"))
    icon.className = themeClass("completionIcon" + (completion.type ? "." + completion.type : ""))
    let {label} = completion, off = 0
    for (let j = 1; j < match.length;) {
      let from = match[j++], to = match[j++]
      if (from > off) li.appendChild(document.createTextNode(label.slice(off, from)))
      let span = li.appendChild(document.createElement("span"))
      span.appendChild(document.createTextNode(label.slice(from, to)))
      span.className = themeClass("completionMatchedText")
      off = to
    }
    if (off < label.length) li.appendChild(document.createTextNode(label.slice(off)))
    li.setAttribute("role", "option")
  }
  return ul
}

// We allocate a new function instance every time the completion
// changes to force redrawing/repositioning of the tooltip
function completionTooltip(options: readonly Option[], id: string) {
  return (view: EditorView): TooltipView => {
    let list = createListBox(options, id)
    list.addEventListener("click", (e: MouseEvent) => {
      let index = 0, dom = e.target as HTMLElement | null
      for (;;) { dom = dom!.previousSibling as (HTMLElement | null); if (!dom) break; index++ }
      if (index < options.length) applyCompletion(view, options[index])
    })
    function updateSel(view: EditorView) {
      let cState = view.state.field(completionState)
      if (cState.open) updateSelectedOption(list, cState.open.selected)
    }
    return {
      dom: list,
      mount: updateSel,
      update(update: ViewUpdate) {
        if (update.state.field(completionState) != update.prevState.field(completionState))
          updateSel(update.view)
      }
    }
  }
}

function updateSelectedOption(list: HTMLElement, selected: number) {
  let set: null | HTMLElement = null
  for (let opt = list.firstChild as (HTMLElement | null), i = 0; opt;
       opt = opt.nextSibling as (HTMLElement | null), i++) {
    if (i == selected) {
      if (!opt.hasAttribute("aria-selected")) {
        opt.setAttribute("aria-selected", "true")
        set = opt
      }
    } else {
      if (opt.hasAttribute("aria-selected")) opt.removeAttribute("aria-selected")
    }
  }
  if (set) scrollIntoView(list, set)
}

function scrollIntoView(container: HTMLElement, element: HTMLElement) {
  let parent = container.getBoundingClientRect()
  let self = element.getBoundingClientRect()
  if (self.top < parent.top) container.scrollTop -= parent.top - self.top
  else if (self.bottom > parent.bottom) container.scrollTop += self.bottom - parent.bottom
}

class RunningQuery {
  time = Date.now()

  constructor(readonly source: Autocompleter,
              readonly explicit: boolean,
              readonly updates: Transaction[],
              public stopped: boolean,
              // Note that 'undefined' means 'not done yet', whereas
              // 'null' means 'query returned null'.
              public done: undefined | CompletionResult | null) {}
}

const DebounceTime = 50, MaxUpdateCount = 50, MinAbortTime = 1000

const autocompletePlugin = ViewPlugin.fromClass(class implements PluginValue {
  debounceUpdate = -1
  running: RunningQuery[] = []
  debounceAccept = -1

  constructor(readonly view: EditorView) {
    for (let active of view.state.field(completionState).active)
      if (active.state == State.Pending) this.startQuery(active)
  }

  update(update: ViewUpdate) {
    let cState = update.state.field(completionState)
    if (!update.selectionSet && !update.docChanged && update.prevState.field(completionState) == cState) return

    let doesReset = update.transactions.some(tr => {
      let event = tr.annotation(Transaction.userEvent)
      return (tr.selection || tr.docChanged) && event != "input" && event != "delete"
    })
    for (let i = 0; i < this.running.length; i++) {
      let query = this.running[i]
      if (doesReset ||
          query.updates.length + update.transactions.length > MaxUpdateCount && query.time - Date.now() > MinAbortTime) {
        query.stopped = true // FIXME allow signalling an abort to the provider somehow
        this.running.splice(i--, 1)
      } else {
        query.updates.push(...update.transactions)
      }
    }

    if (this.debounceUpdate > -1) clearTimeout(this.debounceUpdate)
    this.debounceUpdate = cState.active.some(a => a.state == State.Pending && !this.running.some(q => q.source == a.source))
      ? setTimeout(() => this.startUpdate(), DebounceTime) : -1
  }

  startUpdate() {
    this.debounceUpdate = -1
    let {state} = this.view, cState = state.field(completionState)
    for (let active of cState.active) {
      if (active.state == State.Pending && !this.running.some(r => r.source == active.source))
        this.startQuery(active)
    }
  }

  startQuery(active: ActiveSource) {
    let {state} = this.view, pos = cur(state)
    let pending = new RunningQuery(active.source, active.explicit, [], false, undefined)
    this.running.push(pending)
    Promise.resolve(active.source(new AutocompleteContext(state, pos, active.explicit))).then(result => {
      if (!pending.stopped) {
        pending.done = result || null
        this.scheduleAccept()
      }
    }, err => {
      this.view.dispatch({effects: toggleCompletionEffect.of(false)})
      logException(this.view.state, err)
    })
  }

  scheduleAccept() {
    if (this.running.every(q => q.done !== undefined)) this.accept()
    else if (this.debounceAccept < 0) this.debounceAccept = setTimeout(() => this.accept(), DebounceTime)
  }

  // For each finished query in this.running, try to create a result
  // or, if appropriate, restart the query.
  accept() {
    if (this.debounceAccept > -1) clearTimeout(this.debounceAccept)
    this.debounceAccept = -1

    let updated: ActiveSource[] = []
    for (let i = 0; i < this.running.length; i++) {
      let query = this.running[i]
      if (query.done === undefined) continue
      this.running.splice(i--, 1)

      if (query.done) {
        let active: ActiveSource = new ActiveResult(
          query.source, query.explicit, query.done, query.done.from,
          query.done.to ?? cur(query.updates.length ? query.updates[0].startState : this.view.state),
          query.done.span ? ensureAnchor(query.done.span, true) : null)
        // Replay the transactions that happened since the start of
        // the request and see if that preserves the result
        for (let tr of query.updates) active = active.update(tr)
        if (active.hasResult()) {
          updated.push(active)
          continue
        }
      }

      let current = this.view.state.field(completionState).active.find(a => a.source == query.source)
      if (current && current.state == State.Pending) {
        if (query.done == null) {
          // Explicitly failed. Should clear the pending status if it
          // hasn't been re-set in the meantime.
          let active = new ActiveSource(query.source, State.Inactive, false)
          for (let tr of query.updates) active = active.update(tr)
          if (active.state != State.Pending) updated.push(active)
        } else {
          // Cleared by subsequent transactions. Restart.
          this.startQuery(current)
        }
      }
    }

    if (updated.length) this.view.dispatch({effects: setActiveEffect.of(updated)})
  }
})

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
  return completeFromList(snippets.map(s => ({label: s.name || s.keyword, apply: snippet(s.snippet)})))
}
