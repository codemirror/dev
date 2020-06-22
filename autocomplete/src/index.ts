import {ViewPlugin, PluginValue, ViewUpdate, EditorView, logException, Command} from "@codemirror/next/view"
import {combineConfig, EditorState,
        Transaction, Extension, StateField, StateEffect, Facet, precedence, ChangeDesc} from "@codemirror/next/state"
import {Tooltip, TooltipView, tooltips, showTooltip} from "@codemirror/next/tooltip"
import {keymap, KeyBinding} from "@codemirror/next/view"

/// Denotes how to
/// [filter](#autocomplete.autocomplete^config.filterType)
/// completions.
export enum FilterType {
  /// Only show completions that start with the currently typed text.
  Start,
  /// Show completions that have the typed text anywhere in their
  /// content.
  Fuzzy
}

export class AutocompleteContext {
  /// @internal
  constructor(readonly explicit: boolean,
              readonly filterType: FilterType) {}

  filter(completion: string, text: string) {
    if (this.filterType == FilterType.Start)
      return completion.length > text.length && completion.slice(0, text.length) == text
    else
      return completion.length > text.length && completion.indexOf(text) > -1
  }
}

/// The function signature for a completion source.
export type Autocompleter =
  (state: EditorState, pos: number, context: AutocompleteContext) => readonly Completion[] | Promise<readonly Completion[]>

interface AutocompleteConfig {
  /// When enabled (defaults to true), autocompletion will start
  /// whenever the user types something that can be completed.
  activateOnTyping?: boolean
  /// Override the completion source used.
  override?: Autocompleter | null
  /// Configures how to filter completions.
  filterType?: FilterType
}

/// Objects type used to represent completions.
export interface Completion {
  /// The label to show in the completion picker.
  label: string,
  /// The start of the range that is being completed.
  from: number,
  /// The end of the completed ranges.
  to: number,
  /// How to apply the completion. When this holds a string, the
  /// completion range is replaced by that string. When it is a
  /// function, that function is called to perform the completion.
  apply?: string | ((view: EditorView, completion: Completion) => void)
}

function retrieveCompletions(state: EditorState, pos: number, context: AutocompleteContext): Promise<readonly Completion[]> {
  let found = state.languageDataAt<Autocompleter>("autocomplete", pos)
  function next(i: number): Promise<readonly Completion[]> {
    if (i == found.length) return Promise.resolve([])
    return Promise.resolve(found[i](state, pos, context)).then(result => result.length ? result : next(i + 1))
  }
  return next(0)
}

const autocompleteConfig = Facet.define<AutocompleteConfig, Required<AutocompleteConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      activateOnTyping: true,
      override: null,
      filterType: FilterType.Start
    })
  }
})

/// Returns an extension that enables autocompletion.
export function autocomplete(config: AutocompleteConfig = {}): Extension {
  return [
    activeCompletion,
    autocompleteConfig.of(config),
    autocompletePlugin,
    style,
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
    if (!(active instanceof ActiveCompletion)) return false
    let step = 1, tooltip
    if (by == "page" && (tooltip = view.dom.querySelector(".cm-tooltip-autocomplete") as HTMLElement))
      step = Math.max(2, Math.floor(tooltip.offsetHeight / (tooltip.firstChild as HTMLElement).offsetHeight))
    let selected = active.selected + step * (dir == "up" ? -1 : 1)
    if (selected < 0) selected = by == "page" ? 0 : active.options.length - 1
    else if (selected >= active.options.length) selected = by == "page" ? active.options.length - 1 : 0
    view.dispatch(view.state.update({effects: selectCompletion.of(selected)}))
    return true
  }
}

function acceptCompletion(view: EditorView) {
  let active = view.state.field(activeCompletion)
  if (!(active instanceof ActiveCompletion)) return false
  applyCompletion(view, active.options[active.selected])
  return true
}

/// Explicitly start autocompletion.
export const startCompletion: Command = (view: EditorView) => {
  let active = view.state.field(activeCompletion)
  if (active != null && active != "pending") return false
  view.dispatch(view.state.update({effects: toggleCompletion.of(true)}))
  return true
}

function applyCompletion(view: EditorView, option: Completion) {
  let apply = option.apply || option.label
  if (typeof apply == "string") {
    view.dispatch(view.state.update({
      changes: {from: option.from, to: option.to, insert: apply},
      selection: {anchor: option.from + apply.length}
    }))
  } else {
    apply(view, option)
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

const openCompletion = StateEffect.define<readonly Completion[]>()
const toggleCompletion = StateEffect.define<boolean>()
const selectCompletion = StateEffect.define<number>()

const activeCompletion = StateField.define<ActiveState>({
  create() { return null },

  update(value, tr) {
    let event = tr.annotation(Transaction.userEvent)
    if (event == "input" && (value || tr.state.facet(autocompleteConfig).activateOnTyping) ||
        event == "delete" && value)
      value = "pending"
    // FIXME also allow pending completionst o survive changes somehow
    else if (tr.docChanged && value instanceof ActiveCompletion && !touchesCompletions(value.options, tr.changes))
      value = value.map(tr.changes)
    else if (tr.selection || tr.docChanged)
      value = null
    for (let effect of tr.effects) {
      if (effect.is(openCompletion))
        value = new ActiveCompletion(effect.value, 0)
      else if (effect.is(toggleCompletion))
        value = effect.value ? "pendingExplicit" : null
      else if (effect.is(selectCompletion) && value instanceof ActiveCompletion)
        value = new ActiveCompletion(value.options, effect.value, value.id, value.tooltip)
    }
    return value
  },

  provide: [
    showTooltip.nFrom(active => active instanceof ActiveCompletion ? active.tooltip : none),
    EditorView.contentAttributes.from(active => active instanceof ActiveCompletion ? active.attrs : baseAttrs)
  ]
})

function touchesCompletions(completions: readonly Completion[], changes: ChangeDesc) {
  return changes.length && changes.touchesRange(completions.reduce((m, c) => Math.min(m, c.from), 1e9),
                                                completions.reduce((m, c) => Math.max(m, c.from), 0))
}

const baseAttrs = {"aria-autocomplete": "list"}, none: readonly any[] = []

class ActiveCompletion {
  readonly attrs = {
    "aria-autocomplete": "list",
    "aria-activedescendant": this.id + "-" + this.selected,
    "aria-owns": this.id
  }

  constructor(readonly options: readonly Completion[],
              readonly selected: number,
              readonly id = "cm-ac-" + Math.floor(Math.random() * 1679616).toString(36),
              readonly tooltip: readonly Tooltip[] = [{
                pos: options.reduce((m, o) => Math.min(m, o.from), 1e9),
                style: "autocomplete",
                create: completionTooltip(options, id)
              }]) {}

  map(changes: ChangeDesc) {
    return new ActiveCompletion(
      this.options.map(o => Object.assign({}, o, {from: changes.mapPos(o.from), to: changes.mapPos(o.to)})),
      this.selected)
  }
}

function createListBox(options: readonly Completion[], id: string) {
  const ul = document.createElement("ul")
  ul.id = id
  ul.setAttribute("role", "listbox")
  ul.setAttribute("aria-expanded", "true")
  for (let i = 0; i < options.length; i++) {
    const li = ul.appendChild(document.createElement("li"))
    li.id = id + "-" + i
    li.innerText = options[i].label
    li.setAttribute("role", "option")
  }
  return ul
}

// We allocate a new function instance every time the completion
// changes to force redrawing/repositioning of the tooltip
function completionTooltip(options: readonly Completion[], id: string) {
  return (view: EditorView): TooltipView => {
    let list = createListBox(options, id)
    list.addEventListener("click", (e: MouseEvent) => {
      let index = 0, dom = e.target as HTMLElement | null
      for (;;) { dom = dom!.previousSibling as (HTMLElement | null); if (!dom) break; index++ }
      if (index < options.length) applyCompletion(view, options[index])
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
    let version = this.stateVersion, state = this.view.state, pos = state.selection.primary.head
    let config = state.facet(autocompleteConfig)
    let context = new AutocompleteContext(explicit, config.filterType)
    ;(config.override ? Promise.resolve(config.override(state, pos, context)) : retrieveCompletions(state, pos, context))
      .then(result => {
        if (this.stateVersion != version || result.length == 0) return
        this.view.dispatch(this.view.state.update({effects: openCompletion.of(result)}))
      })
      .catch(e => logException(this.view.state, e))
  }
})

const style = EditorView.baseTheme({
  "tooltip.autocomplete": {
    fontFamily: "monospace",
    overflowY: "auto",
    maxHeight: "10em",
    listStyle: "none",
    margin: 0,
    padding: 0,

    "& > li": {
      cursor: "pointer",
      padding: "1px 1em 1px 3px",
      lineHeight: 1.2
    },

    "& > li[aria-selected]": {
      background_fallback: "#bdf",
      backgroundColor: "Highlight",
      color_fallback: "white",
      color: "HighlightText"
    }
  }
})
