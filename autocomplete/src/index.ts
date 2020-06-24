import {ViewPlugin, PluginValue, ViewUpdate, EditorView, logException, Command} from "@codemirror/next/view"
import {combineConfig, Transaction, Extension, StateField, StateEffect, Facet, precedence,
        ChangeDesc} from "@codemirror/next/state"
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
    /// The editor view that the completion happens in.
    readonly view: EditorView,
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

  /// The editor state.
  get state() { return this.view.state }

  /// Filter a given completion string against the partial input in
  /// `text`. Will use `this.filterType`, returns `true` when the
  /// completion should be shown.
  filter(completion: string, text: string, caseSensitive = this.caseSensitive) {
    if (!caseSensitive) {
      completion = completion.toLowerCase()
      text = text.toLowerCase()
    }
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
}

/// Interface for objects returned by completion sources.
export interface CompletionResult {
  /// The start of the range that is being completed.
  from: number,
  /// The end of the completed range.
  to: number,
  /// The completions
  options: readonly Completion[],
  /// Whether the library is responsible for filtering the completions
  /// (defaults to false). When `true`, further typing will not query
  /// the completion source again, but instead continue filtering the
  /// given list of options.
  filter?: boolean
}

/// Objects type used to represent individual completions.
export interface Completion {
  /// The label to show in the completion picker.
  label: string,
  /// How to apply the completion. When this holds a string, the
  /// completion range is replaced by that string. When it is a
  /// function, that function is called to perform the completion.
  apply?: string | ((view: EditorView, result: CompletionResult, completion: Completion) => void)
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
                results: readonly (CompletionResult | null)[],
                context: AutocompleteContext) {
    let options = []
    for (let i = 0, result; i < results.length; i++) if (result = results[i]) {
      let prefix = null
      for (let option of result.options) {
        if (!result.filter ||
            (result.from == result.to ? context.explicit :
             context.filter(prefix || (prefix = context.state.sliceDoc(result.from, result.to)), option.label)))
          options.push({completion: option, source: i})
      }
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
}

function retrieveCompletions(view: EditorView, explicit: boolean): Promise<CombinedResult> {
  let config = view.state.facet(autocompleteConfig), pos = view.state.selection.primary.head
  let sources = config.override ? [config.override] : view.state.languageDataAt<Autocompleter>("autocomplete", pos)
  let context = new AutocompleteContext(view, pos, explicit, config.filterType, config.caseSensitive)
  return Promise.all(sources.map(source => source(context))).then(results => CombinedResult.create(sources, results, context))
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
    view.dispatch(view.state.update({effects: selectCompletion.of(selected)}))
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
  let active = view.state.field(activeCompletion)
  if (active != null && active != "pending") return false
  view.dispatch(view.state.update({effects: toggleCompletion.of(true)}))
  return true
}

function applyCompletion(view: EditorView, combined: CombinedResult, index: number) {
  let option = combined.options[index]
  let apply = option.completion.apply || option.completion.label
  let result = combined.results[option.source]!
  if (typeof apply == "string") {
    view.dispatch(view.state.update({
      changes: {from: result.from, to: result.to, insert: apply},
      selection: {anchor: result.from + apply.length}
    }))
  } else {
    apply(view, result, option.completion)
  }
}

/// Close the currently active completion.
export const closeCompletion: Command = (view: EditorView) => {
  let active = view.state.field(activeCompletion, false)
  if (active == null) return false
  view.dispatch(view.state.update({effects: toggleCompletion.of(false)}))
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

type ActiveState = ActiveCompletion // There is a completion active
  | null // No completion active
  | "pending" // Must update after user input
  | "pendingExplicit" // Must update after explicit completion command

const openCompletion = StateEffect.define<CombinedResult>()
const toggleCompletion = StateEffect.define<boolean>()
const selectCompletion = StateEffect.define<number>()

const activeCompletion = StateField.define<ActiveState>({
  create() { return null },

  update(value, tr) {
    let event = tr.annotation(Transaction.userEvent)
    if (event == "input" && (value || tr.state.facet(autocompleteConfig).activateOnTyping) ||
        event == "delete" && value)
      value = "pending"
    // FIXME also allow pending completions to survive changes somehow
    else if (tr.docChanged && value instanceof ActiveCompletion && !tr.changes.touchesRange(value.result.from, value.result.to))
      value = value.map(tr.changes)
    else if (tr.selection || tr.docChanged)
      value = null
    for (let effect of tr.effects) {
      if (effect.is(openCompletion))
        value = new ActiveCompletion(effect.value, 0)
      else if (effect.is(toggleCompletion))
        value = effect.value ? "pendingExplicit" : null
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

  map(changes: ChangeDesc) {
    return new ActiveCompletion(this.result.map(changes), this.selected, this.timeStamp)
  }
}

function createListBox(result: CombinedResult, id: string) {
  const ul = document.createElement("ul")
  ul.id = id
  ul.setAttribute("role", "listbox")
  ul.setAttribute("aria-expanded", "true")
  for (let i = 0; i < result.options.length; i++) {
    const li = ul.appendChild(document.createElement("li"))
    li.id = id + "-" + i
    li.innerText = result.options[i].completion.label
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
    this.stateVersion++
    if (this.debounce > -1) clearTimeout(this.debounce)
    let active = update.state.field(activeCompletion)
    this.debounce = active == "pending" || active == "pendingExplicit"
      ? setTimeout(() => this.startUpdate(active == "pendingExplicit"), DebounceTime) : -1
  }

  startUpdate(explicit: boolean) {
    this.debounce = -1
    let {view, stateVersion} = this
    retrieveCompletions(view, explicit).then(result => {
      if (this.stateVersion != stateVersion || result.options.length == 0) return
      view.dispatch(view.state.update({effects: openCompletion.of(result)}))
    }).catch(e => logException(view.state, e))
  }
})

export {snippet, completeSnippets, SnippetSpec} from "./snippet"
