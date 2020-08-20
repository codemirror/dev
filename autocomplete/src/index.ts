import {ViewPlugin, PluginValue, ViewUpdate, EditorView, logException, Command, themeClass} from "@codemirror/next/view"
import {combineConfig, Transaction, Extension, StateField, StateEffect, Facet, precedence,
        EditorState} from "@codemirror/next/state"
import {Tooltip, TooltipView, tooltips, showTooltip} from "@codemirror/next/tooltip"
import {keymap, KeyBinding} from "@codemirror/next/view"
import {baseTheme} from "./theme"
import {FuzzyMatcher} from "./filter"

/// Objects type used to represent individual completions.
export interface Completion {
  /// The label to show in the completion picker.
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
  tokenBefore() { // FIXME this is not the right approach
    let from = this.pos, type = null, text = ""
    let token = this.state.tree.resolve(this.pos, -1)
    if (!token.firstChild && token.start < this.pos) {
      from = token.start
      type = token.type
      text = this.state.sliceDoc(from, this.pos)
    }
    return {from, to: this.pos, text, type}
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

const enum Pending { No, Implicit, Explicit }

const MaxOptions = 300

function sortOptions(active: readonly ActiveCompletion[], state: EditorState) {
  let options = []
  for (let a of active) {
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
}


class CompletionState {
  constructor(readonly active: readonly ActiveCompletion[],
              readonly pending: Pending,
              readonly id: string,
              readonly open: CompletionDialog | null) {}

  static start() {
    return new CompletionState(none, Pending.No, "cm-ac-" + Math.floor(Math.random() * 1679616).toString(36), null)
  }

  setSelected(selected: number) {
    let open = this.open
    return !open || selected == open.selected ? this
      : new CompletionState(this.active, this.pending, this.id,
                            new CompletionDialog(open.options, makeAttrs(this.id, selected), open.tooltip, open.timestamp, selected))
  }

  setPending(pending: Pending) {
    return pending == this.pending ? this : new CompletionState(this.active, pending, this.id, this.open)
  }

  setActive(active: readonly ActiveCompletion[], state: EditorState) {
    let options = sortOptions(active, state), open = null
    if (options.length) {
      let selected = 0
      if (this.open) {
        let selectedValue = this.open.options[this.open.selected].completion
        for (let i = 0; i < options.length && !selected; i++) {
          if (options[i].completion == selectedValue) selected = i
        }
      }
      open = new CompletionDialog(options, makeAttrs(this.id, selected), [{
        pos: active.reduce((a, b) => Math.min(a, b.from), 1e8),
        style: "autocomplete",
        create: completionTooltip(options, this.id)
      }], this.open ? this.open.timestamp : Date.now(), selected)
    }
    return new CompletionState(active, this.pending, this.id, open)
  }

  update(tr: Transaction) {
    let value: CompletionState = this
    let event = tr.annotation(Transaction.userEvent), cur = tr.state.selection.primary.head
    if (event == "input" && (value.active.length || tr.state.facet(autocompleteConfig).activateOnTyping) ||
        event == "delete" && value.active.some(a => a.from < cur || a.from == cur && a.explicit))
      value = value.setPending(Pending.Implicit)
    else if (tr.selection || tr.changes.touchesRange(tr.state.selection.primary.head))
      value = value.setPending(Pending.No)

    if (value.active.length) {
      let active = []
      for (let a of value.active) {
        let updated = a.update(tr)
        if (updated) active.push(updated)
      }
      value = value.setActive(active, tr.state)
    }

    for (let effect of tr.effects) {
      if (effect.is(setCompletionState))
        value = effect.value
      else if (effect.is(toggleCompletion))
        value = effect.value ? value.setPending(Pending.Explicit) : value.setActive(none, tr.state).setPending(Pending.No)
    }
    return value
  }

  get tooltip(): readonly Tooltip[] { return this.open ? this.open.tooltip : none }

  get attrs() { return this.open ? this.open.attrs : baseAttrs }
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

class ActiveCompletion {
  constructor(readonly source: Autocompleter,
              readonly result: CompletionResult,
              readonly from: number,
              readonly to: number,
              readonly span: RegExp | null,
              readonly explicit: boolean) {}

  update(tr: Transaction) {
    let from = tr.changes.mapPos(this.from), to = tr.changes.mapPos(this.to, 1)
    // Change isn't relevant
    if (!tr.selection && !tr.changes.touchesRange(this.from, this.to))
      return new ActiveCompletion(this.source, this.result, from, to, this.span, this.explicit)
    let event = tr.annotation(Transaction.userEvent)
    if ((event == "input" || event == "delete") && this.span) {
      let cur = tr.state.selection.primary.head
      if ((this.explicit ? cur >= from : cur > from) && cur <= to && this.span.test(tr.state.sliceDoc(from, to)))
        return new ActiveCompletion(this.source, this.result, from, to, this.span, this.explicit)
    }
    return null
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
              readonly source: ActiveCompletion,
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
    view.dispatch({effects: setCompletionState.of(cState.setSelected(selected))})
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
  if (cState.open || cState.pending == Pending.Explicit) return false
  view.dispatch({effects: toggleCompletion.of(true)})
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
  if (!cState || !(cState.open || cState.pending == Pending.Explicit)) return false
  view.dispatch({effects: toggleCompletion.of(false)})
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

const setCompletionState = StateEffect.define<CompletionState>()
const toggleCompletion = StateEffect.define<boolean>()

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
  return !cState ? null : cState.open ? "active" : cState.pending == Pending.No ? null : "pending"
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

class PendingQuery {
  constructor(readonly source: Autocompleter,
              readonly updates: Transaction[],
              public stopped: boolean,
              public done: ActiveCompletion | null) {}
}

const DebounceTime = 50

const autocompletePlugin = ViewPlugin.fromClass(class implements PluginValue {
  debounceUpdate = -1
  retrieving: PendingQuery[] = []
  debounceAccept = -1

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    let cState = update.state.field(completionState)
    if (!update.docChanged && !update.selectionSet && update.prevState.field(completionState) == cState) return
    if (this.debounceUpdate > -1) clearTimeout(this.debounceUpdate)
    this.debounceUpdate = cState.pending == Pending.No ? -1 : setTimeout(() => this.startUpdate(), DebounceTime)
    let doesReset = update.transactions.some(tr => {
      let event = tr.annotation(Transaction.userEvent)
      return (tr.selection || tr.docChanged) && event != "input" && event != "delete"
    })
    for (let i = 0; i < this.retrieving.length; i++) {
      let query = this.retrieving[i]
      if (doesReset) {
        query.stopped = true // FIXME allow signalling an abort to the provider somehow
        this.retrieving.splice(i--, 1)
      } else if (query.done) {
        query.done = update.transactions.reduce((done, tr) => done && done.update(tr), query.done as ActiveCompletion | null)
        if (!query.done) this.retrieving.splice(i--, 1)
      } else {
        query.updates.push(...update.transactions)
      }
    }
  }

  startUpdate() {
    this.debounceUpdate = -1
    let {state} = this.view
    let cState = state.field(completionState)
    if (cState.pending == Pending.No) return
    let pos = state.selection.primary.head
    for (let source of state.facet(autocompleteConfig).override || state.languageDataAt<Autocompleter>("autocomplete", pos)) {
      if (cState.active.some(a => a.source == source) || this.retrieving.some(s => s.source == source))
        continue
      this.startQuery(source, cState.pending == Pending.Explicit)
    }
    this.view.dispatch({effects: setCompletionState.of(cState.setPending(Pending.No))})
  }

  startQuery(source: Autocompleter, explicit: boolean) {
    let {state} = this.view, pos = state.selection.primary.head
    let pending = new PendingQuery(source, [], false, null)
    this.retrieving.push(pending)
    Promise.resolve(source(new AutocompleteContext(state, pos, explicit))).then(result => {
      if (pending.stopped) {
        // Drop the result
      } else if (!result) {
        this.retrieving.splice(this.retrieving.indexOf(pending), 1)
      } else {
        let active: ActiveCompletion | null = new ActiveCompletion(pending.source, result, result.from, result.to ?? pos,
                                                                   result.span ? ensureAnchor(result.span, true) : null,
                                                                   explicit)
        for (let tr of pending.updates) active = active && active.update(tr)
        if (active) {
          pending.done = active
          this.scheduleAccept()
        } else {
          this.retrieving.splice(this.retrieving.indexOf(pending), 1)
          this.startQuery(source, explicit)
        }
      }
    }, err => {
      this.view.dispatch({effects: toggleCompletion.of(false)})
      logException(this.view.state, err)
    })
  }

  scheduleAccept() {
    if (this.retrieving.every(q => q.done)) this.accept()
    else if (this.debounceAccept < 0) this.debounceAccept = setTimeout(() => this.accept(), DebounceTime)
  }

  accept() {
    if (this.debounceAccept > -1) clearTimeout(this.debounceAccept)
    this.debounceAccept = -1

    let active = []
    for (let i = 0; i < this.retrieving.length; i++) {
      let query = this.retrieving[i]
      if (query.done) {
        this.retrieving.splice(i--, 1)
        active.push(query.done)
      }
    }
    if (active.length) {
      let {state} = this.view, cState = state.field(completionState)
      this.view.dispatch({effects: setCompletionState.of(cState.setActive(cState.active.concat(active), state))})
    }
  }
})

/// Given a a fixed array of options, return an autocompleter that
/// compares those options to the current
/// [token](#autocomplete.AutocompleteContext.tokenBefore) and returns
/// the matching ones.
export function completeFromList(list: readonly (string | Completion)[]): Autocompleter {
  let options = list.map(o => typeof o == "string" ? {label: o} : o) as Completion[]
  let span = options.every(o => /^\w+$/.test(o.label)) ? /^\w+$/
    : new RegExp(`^(${options.map(o => o.label.replace(/[^\s\w]/g, "\\$&")).join("|")})$`)
  return (context: AutocompleteContext) => {
    let token = context.tokenBefore()
    return {from: token.from, options, span}
  }
}

export {snippet, completeSnippets, SnippetSpec} from "./snippet"
