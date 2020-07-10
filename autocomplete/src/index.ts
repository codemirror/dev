import {ViewPlugin, PluginValue, ViewUpdate, EditorView, logException, Command, themeClass} from "@codemirror/next/view"
import {combineConfig, Transaction, Extension, StateField, StateEffect, Facet, precedence,
        ChangeDesc, EditorState} from "@codemirror/next/state"
import {Tooltip, TooltipView, tooltips, showTooltip} from "@codemirror/next/tooltip"
import {keymap, KeyBinding} from "@codemirror/next/view"
import {baseTheme} from "./theme"

/// Denotes how to
/// [filter](#autocomplete.autocomplete^config.filterType)
/// completions.
export enum FilterType {
  /// Only show completions that start with the currently typed text.
  Start,
  /// Show completions that have the typed text anywhere in their
  /// content.
  Include,
  /// Show completions that include each character of the typed text,
  /// in order (so `gBCR` could complete to `getBoundingClientRect`).
  Fuzzy
}

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
    readonly explicit: boolean,
    /// The configured completion filter. Ignoring this won't break
    /// anything, but supporting it is encouraged.
    readonly filterType: FilterType,
    /// Indicates whether completion has been configured to be
    /// case-sensitive. Again, this should be taken as a hint, not a
    /// requirement.
    readonly caseSensitive: boolean
  ) {}

  /// Filter a given completion string against the partial input in
  /// `text`. Will use `this.filterType`, returns `true` when the
  /// completion should be shown.
  filter(completion: string, text: string, caseSensitive = this.caseSensitive) {
    if (!caseSensitive && completion == completion.toLowerCase())
      text = text.toLowerCase()
    if (this.filterType == FilterType.Start)
      return completion.slice(0, text.length) == text
    else if (this.filterType == FilterType.Include)
      return completion.indexOf(text) > -1
    // Fuzzy
    for (let i = 0, j = 0; i < text.length; i++) {
      let found = completion.indexOf(text[i], j)
      if (found < 0) return false
      j = found + 1
    }
    return true
  }

  /// Get the extent, content, and (if there is a token) type of the
  /// token before `this.pos`.
  tokenBefore() {
    let from = this.pos, type = null, text = ""
    let token = this.state.tree.resolve(this.pos, -1)
    if (!token.firstChild && token.start < this.pos) {
      from = token.start
      type = token.type
      text = this.state.sliceDoc(from, this.pos)
    }
    return {from, to: this.pos, text, type}
  }
}

/// Interface for objects returned by completion sources.
export interface CompletionResult {
  /// The start of the range that is being completed.
  from: number,
  /// The end of the completed range.
  to: number,
  /// The completions
  options: readonly Completion[],
  /// When given, further input that matches the regexp will cause the
  /// given options to be re-filtered with the extended string, rather
  /// than calling the completion source anew. This can help with
  /// responsiveness, since it allows the completion list to be
  /// updated synchronously.
  filterDownOn?: RegExp
}

function canRefilter(result: CompletionResult, state: EditorState, changes?: ChangeDesc) {
  if (!result.filterDownOn) return false
  let to = changes ? changes.mapPos(result.to) : result.to, pos = state.selection.primary.head
  if (pos < to || pos > to + 20) return false
  return pos == to || result.filterDownOn.test(state.sliceDoc(to, pos))
}

function refilter(result: CompletionResult, context: AutocompleteContext) {
  let text = context.state.sliceDoc(result.from, context.pos)
  return {
    from: result.from,
    to: context.pos,
    options: result.options.filter(opt => context.filter(opt.label, text)),
    filterDownOn: result.filterDownOn
  }
}

/// Objects type used to represent individual completions.
export interface Completion {
  /// The label to show in the completion picker.
  label: string,
  /// How to apply the completion. When this holds a string, the
  /// completion range is replaced by that string. When it is a
  /// function, that function is called to perform the completion.
  apply?: string | ((view: EditorView, result: CompletionResult, completion: Completion) => void),
  /// The type of the completion. This is used to pick an icon to show
  /// for the completion. Icons are styled with a theme selector
  /// created by appending the given type name to `"completionIcon."`.
  /// You can define or restyle icons by defining these selectors. The
  /// base library defines simple icons for `class`, `constant`,
  /// `enum`, `function`, `interface`, `keyword`, `method`,
  /// `namespace`, `property`, `text`, `type`, and `variable`.
  type?: string
}

/// The function signature for a completion source. Such a function
/// may return its [result](#autocomplete.CompletionResult)
/// synchronously or as a promise. Returning null indicates no
/// completions are available.
export type Autocompleter =
  (context: AutocompleteContext) => CompletionResult | null | Promise<CompletionResult | null>

interface AutocompleteConfig {
  /// When enabled (defaults to true), autocompletion will start
  /// whenever the user types something that can be completed.
  activateOnTyping?: boolean
  /// Override the completion source used.
  override?: Autocompleter | null
  /// Configures how to filter completions.
  filterType?: FilterType
  /// Configures whether completion is case-sensitive (defaults to
  /// false).
  caseSensitive?: boolean
}

class CombinedResult {
  constructor(readonly sources: readonly Autocompleter[],
              readonly results: readonly (CompletionResult | null)[],
              readonly options: readonly {completion: Completion, source: number}[]) {}

  static create(sources: readonly Autocompleter[],
                results: readonly (CompletionResult | null)[]) {
    let options = []
    for (let i = 0, result; i < results.length; i++) if (result = results[i]) {
      for (let option of result.options) options.push({completion: option, source: i})
    }
    return new CombinedResult(sources, results,
                              options.sort(({completion: {label: a}}, {completion: {label: b}}) => a < b ? -1 : a == b ? 0 : 1))
  }

  get from() { return this.results.reduce((m, r) => r ? Math.min(m, r.from) : m, 1e9) }
  get to() { return this.results.reduce((m, r) => r ? Math.max(m, r.to) : m, 0) }

  map(changes: ChangeDesc) {
    return new CombinedResult(this.sources,
                              this.results.map(r => r && {...r, ...{from: changes.mapPos(r.from), to: changes.mapPos(r.to)}}),
                              this.options)
  }

  refilterAll(state: EditorState) {
    let config = state.facet(autocompleteConfig), pos = state.selection.primary.head
    let context = new AutocompleteContext(state, pos, false, config.filterType, config.caseSensitive)
    return CombinedResult.create(this.sources, this.results.map(r => r && refilter(r, context)))
  }
}

function retrieveCompletions(state: EditorState, pending: PendingCompletion): Promise<CombinedResult> {
  let config = state.facet(autocompleteConfig), pos = state.selection.primary.head
  let sources = config.override ? [config.override] : state.languageDataAt<Autocompleter>("autocomplete", pos)
  let context = new AutocompleteContext(state, pos, pending.explicit, config.filterType, config.caseSensitive)
  return Promise.all(sources.map(source => {
    let prevIndex = pending.prev ? pending.prev.result.sources.indexOf(source) : -1
    let prev = prevIndex < 0 ? null : pending.prev!.result.results[prevIndex]
    return (prev && canRefilter(prev, state) && refilter(prev, context)) || source(context)
  })).then(results => CombinedResult.create(sources, results))
}

const autocompleteConfig = Facet.define<AutocompleteConfig, Required<AutocompleteConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      activateOnTyping: true,
      override: null,
      filterType: FilterType.Start,
      caseSensitive: false
    })
  }
})

/// Returns an extension that enables autocompletion.
export function autocomplete(config: AutocompleteConfig = {}): Extension {
  return [
    activeCompletion,
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

function moveCompletion(dir: string, by?: string) {
  return (view: EditorView) => {
    let active = view.state.field(activeCompletion)
    if (!(active instanceof ActiveCompletion) || Date.now() - active.timeStamp < CompletionInteractMargin) return false
    let step = 1, tooltip
    if (by == "page" && (tooltip = view.dom.querySelector(".cm-tooltip-autocomplete") as HTMLElement))
      step = Math.max(2, Math.floor(tooltip.offsetHeight / (tooltip.firstChild as HTMLElement).offsetHeight))
    let selected = active.selected + step * (dir == "up" ? -1 : 1), {length} = active.result.options
    if (selected < 0) selected = by == "page" ? 0 : length - 1
    else if (selected >= length) selected = by == "page" ? length - 1 : 0
    view.dispatch({effects: selectCompletion.of(selected)})
    return true
  }
}

const CompletionInteractMargin = 75

function acceptCompletion(view: EditorView) {
  let active = view.state.field(activeCompletion)
  if (!(active instanceof ActiveCompletion) || Date.now() - active.timeStamp < CompletionInteractMargin) return false
  applyCompletion(view, active.result, active.selected)
  return true
}

/// Explicitly start autocompletion.
export const startCompletion: Command = (view: EditorView) => {
  let active = view.state.field(activeCompletion, false)
  if (active === undefined) return false
  if (active instanceof ActiveCompletion || (active instanceof PendingCompletion && active.explicit)) return false
  view.dispatch({effects: toggleCompletion.of(true)})
  return true
}

function applyCompletion(view: EditorView, combined: CombinedResult, index: number) {
  let option = combined.options[index]
  let apply = option.completion.apply || option.completion.label
  let result = combined.results[option.source]!
  if (typeof apply == "string") {
    view.dispatch({
      changes: {from: result.from, to: result.to, insert: apply},
      selection: {anchor: result.from + apply.length}
    })
  } else {
    apply(view, result, option.completion)
  }
}

/// Close the currently active completion.
export const closeCompletion: Command = (view: EditorView) => {
  let active = view.state.field(activeCompletion, false)
  if (active == null) return false
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

const openCompletion = StateEffect.define<CombinedResult>()
const toggleCompletion = StateEffect.define<boolean>()
const selectCompletion = StateEffect.define<number>()

function touchesCompletion(tr: Transaction, completion: ActiveCompletion | PendingCompletion) {
  return completion instanceof ActiveCompletion ? tr.changes.touchesRange(completion.result.from, completion.result.to)
    : tr.changes.touchesRange(tr.state.selection.primary.head)
}

const activeCompletion = StateField.define<ActiveCompletion | PendingCompletion | null>({
  create() { return null },

  update(value, tr) {
    let event = tr.annotation(Transaction.userEvent)
    if (event == "input" && value instanceof ActiveCompletion &&
        value.result.results.every(r => !r || canRefilter(r, tr.state, tr.changes))) {
      value = new ActiveCompletion(value.result.map(tr.changes).refilterAll(tr.state), 0, value.timeStamp)
    } else if (event == "input" && (value || tr.state.facet(autocompleteConfig).activateOnTyping) ||
               event == "delete" && value) {
      let prev = value instanceof ActiveCompletion ? value : value instanceof PendingCompletion ? value.prev : null
      value = new PendingCompletion(prev, value instanceof PendingCompletion ? value.explicit : false)
    } else if (value && (tr.selection || tr.docChanged && touchesCompletion(tr, value))) {
      // Clear on selection changes or changes that touch the completion
      value = null
    } else if (tr.docChanged && value instanceof ActiveCompletion) {
      value = new ActiveCompletion(value.result.map(tr.changes), value.selected, value.timeStamp)
    }
    for (let effect of tr.effects) {
      if (effect.is(openCompletion))
        value = new ActiveCompletion(effect.value, 0)
      else if (effect.is(toggleCompletion))
        value = effect.value ? new PendingCompletion(null, true) : null
      else if (effect.is(selectCompletion) && value instanceof ActiveCompletion)
        value = new ActiveCompletion(value.result, effect.value, value.timeStamp, value.id, value.tooltip)
    }
    return value
  },

  provide: [
    showTooltip.nFrom(active => active instanceof ActiveCompletion ? active.tooltip : none),
    EditorView.contentAttributes.from(active => active instanceof ActiveCompletion ? active.attrs : baseAttrs)
  ]
})

const baseAttrs = {"aria-autocomplete": "list"}, none: readonly any[] = []

class ActiveCompletion {
  readonly attrs = {
    "aria-autocomplete": "list",
    "aria-activedescendant": this.id + "-" + this.selected,
    "aria-owns": this.id
  }

  constructor(readonly result: CombinedResult,
              readonly selected: number,
              readonly timeStamp = Date.now(),
              readonly id = "cm-ac-" + Math.floor(Math.random() * 1679616).toString(36),
              readonly tooltip: readonly Tooltip[] = [{
                pos: result.from,
                style: "autocomplete",
                create: completionTooltip(result, id)
              }]) {}
}

class PendingCompletion {
  constructor(readonly prev: ActiveCompletion | null,
              readonly explicit: boolean) {}
}

function createListBox(result: CombinedResult, id: string) {
  const ul = document.createElement("ul")
  ul.id = id
  ul.setAttribute("role", "listbox")
  ul.setAttribute("aria-expanded", "true")
  for (let i = 0; i < result.options.length; i++) {
    let {completion} = result.options[i]
    const li = ul.appendChild(document.createElement("li"))
    li.id = id + "-" + i
    let icon = li.appendChild(document.createElement("div"))
    icon.className = themeClass("completionIcon" + (completion.type ? "." + completion.type : ""))
    li.appendChild(document.createTextNode(completion.label))
    li.setAttribute("role", "option")
  }
  return ul
}

// We allocate a new function instance every time the completion
// changes to force redrawing/repositioning of the tooltip
function completionTooltip(result: CombinedResult, id: string) {
  return (view: EditorView): TooltipView => {
    let list = createListBox(result, id)
    list.addEventListener("click", (e: MouseEvent) => {
      let index = 0, dom = e.target as HTMLElement | null
      for (;;) { dom = dom!.previousSibling as (HTMLElement | null); if (!dom) break; index++ }
      if (index < result.options.length) applyCompletion(view, result, index)
    })
    function updateSel(view: EditorView) {
      let cur = view.state.field(activeCompletion)
      if (cur instanceof ActiveCompletion) updateSelectedOption(list, cur.selected)
    }
    return {
      dom: list,
      mount: updateSel,
      update(update: ViewUpdate) {
        if (update.state.field(activeCompletion) != update.prevState.field(activeCompletion))
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

const DebounceTime = 100

const autocompletePlugin = ViewPlugin.fromClass(class implements PluginValue {
  stateVersion = 0
  debounce = -1

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet &&
        update.prevState.field(activeCompletion) == update.state.field(activeCompletion)) return
    if (update.docChanged || update.selectionSet) this.stateVersion++
    if (this.debounce > -1) clearTimeout(this.debounce)
    const active = update.state.field(activeCompletion)
    this.debounce = active instanceof PendingCompletion
      ? setTimeout(() => this.startUpdate(active), DebounceTime) : -1
  }

  startUpdate(pending: PendingCompletion) {
    this.debounce = -1
    let {view, stateVersion} = this
    retrieveCompletions(view.state, pending).then(result => {
      if (this.stateVersion != stateVersion || result.options.length == 0) return
      view.dispatch({effects: openCompletion.of(result)})
    }).catch(e => logException(view.state, e))
  }
})

/// Given a a fixed array of options, return an autocompleter that
/// compares those options to the current
/// [token](#autocomplete.AutocompleteContext.tokenBefore) and returns
/// the matching ones.
export function completeFromList(list: readonly (string | Completion)[]): Autocompleter {
  let options = list.map(o => typeof o == "string" ? {label: o} : o) as Completion[]
  let filterDownOn = options.every(o => /^\w+$/.test(o.label)) ? /^\w+$/ : undefined
  return (context: AutocompleteContext) => {
    let token = context.tokenBefore()
    return {from: token.from, to: token.to,
            options: options.filter(o => context.filter(o.label, token.text)),
            filterDownOn}
  }
}

export {snippet, completeSnippets, SnippetSpec} from "./snippet"
