import {ViewPlugin, ViewUpdate, EditorView} from "../../view"
import {combineConfig, Annotation, CancellablePromise, EditorSelection, EditorState,
        Transaction, Extension, StateField, defineFacet, Precedence} from "../../state"
import {keymap} from "../../keymap"
import {Tooltip, tooltips, showTooltip} from "../../tooltip"

export interface AutocompleteData {
  completeAt: (state: EditorState, pos: number) => CompletionResult | CancellablePromise<CompletionResult>
}

export interface CompletionResult {
  items: readonly Completion[]
}

export interface Completion {
  label: string,
  start: number,
  end: number,
  apply?: string | ((view: EditorView) => void)
}

export function completeFromSyntax(state: EditorState, pos: number): CompletionResult | CancellablePromise<CompletionResult> {
  let syntax = state.facet(EditorState.syntax)
  if (syntax.length == 0) return {items: []}
  let {completeAt} = syntax[0].languageDataAt<AutocompleteData>(state, pos)
  return completeAt ? completeAt(state, pos) : {items: []}
}

export function sortAndFilterCompletion(substr: string, items: ReadonlyArray<Completion>) {
  const startMatch = [], inMatch = []
  for (const item of items) {
    if (item.label == substr) continue
    // FIXME: separate key
    else if (item.label.startsWith(substr)) startMatch.push(item)
    else if (item.label.includes(substr)) inMatch.push(item)
  }
  return startMatch.concat(inMatch)
}

const autocompleteConfig = defineFacet<Partial<AutocompleteData>, AutocompleteData>({
  combine(configs) {
    return combineConfig(configs, {
      completeAt(state: EditorState, pos: number) {
        return completeFromSyntax(state, pos) || {start: pos, items: []}
      }
    })
  }
})

export function autocomplete(config: Partial<AutocompleteData> = {}): Extension {
  return [
    activeCompletion,
    autocompleteConfig.of(config),
    Autocomplete.extension,
    Precedence.Fallback.set(style),
    tooltips(),
    Precedence.Override.set(keymap({
      ArrowDown: moveCompletion("down"),
      ArrowUp: moveCompletion("up"),
      Enter: acceptCompletion,
      Escape: closeCompletion
    }))
  ]
}

function moveCompletion(dir: string) {
  return (view: EditorView) => {
    let active = view.state.field(activeCompletion)
    if (!(active instanceof ActiveCompletion)) return false
    let selected = (active.selected + (dir == "up" ? active.options.length - 1 : 1)) % active.options.length
    view.dispatch(view.state.t().annotate(setActiveCompletion(new ActiveCompletion(active.options, selected, active.tooltip))))
    return true
  }
}

function acceptCompletion(view: EditorView) {
  let active = view.state.field(activeCompletion)
  if (!(active instanceof ActiveCompletion)) return false
  applyCompletion(view, active.options[active.selected])
  return true
}

export function startCompletion(view: EditorView) {
  let active = view.state.field(activeCompletion)
  if (active != null) return false
  view.dispatch(view.state.t().annotate(setActiveCompletion("pending")))
  return true
}

function applyCompletion(view: EditorView, option: Completion) {
  let apply = option.apply || option.label
  // FIXME make sure option.start/end still point at the current
  // doc, or keep a mapping in an active completion
  if (typeof apply == "string") {
    view.dispatch(view.state.t().replace(option.start, option.end, apply)
                  .setSelection(EditorSelection.single(option.start + apply.length)))
  } else {
    apply(view)
  }
}

function closeCompletion(view: EditorView) {
  let active = view.state.field(activeCompletion)
  if (active == null) return false
  view.dispatch(view.state.t().annotate(setActiveCompletion(null)))
  return true
}

const setActiveCompletion = Annotation.define<ActiveCompletion | null | "pending">()

const activeCompletion = StateField.define<ActiveCompletion | null | "pending">({
  create() { return null },
  update(prev, tr, state) {
    let set = tr.annotation(setActiveCompletion)
    if (set !== undefined) return set

    return tr.annotation(Transaction.userEvent) == "input" ? "pending"
      : tr.docChanged || tr.selectionSet ? null
      : prev
  }
}).provideN(showTooltip, active => active instanceof ActiveCompletion ? [active.tooltip] : [])

class ActiveCompletion {
  constructor(readonly options: readonly Completion[],
              readonly selected: number,
              readonly tooltip: (view: EditorView) => Tooltip) {}
}

function createListBox(options: readonly Completion[]) {
  const ul = document.createElement("ul")
  ul.setAttribute("role", "listbox") // FIXME this won't be focused, so the aria attributes aren't really useful
  for (let option of options) {
    const li = ul.appendChild(document.createElement("li"))
    li.innerText = option.label
    li.setAttribute("role", "option")
  }
  return ul
}

function buildTooltip(options: readonly Completion[]) {
  return (view: EditorView): Tooltip => {
    let list = createListBox(options)
    list.addEventListener("click", (e: MouseEvent) => {
      let index = 0, dom = e.target as HTMLElement | null
      for (;;) { dom = dom!.previousSibling as (HTMLElement | null); if (!dom) break; index++ }
      let active = view.state.field(activeCompletion)
      if (active instanceof ActiveCompletion && index < active.options.length)
        applyCompletion(view, active.options[index])
    })
    function updateSel(view: EditorView) {
      let cur = view.state.field(activeCompletion)
      if (cur instanceof ActiveCompletion) updateSelectedOption(list, cur.selected)
    }
    return {
      dom: list,
      mount: updateSel,
      update(update: ViewUpdate) {
        if (update.state.field(activeCompletion) != update.prevState.field(activeCompletion)) updateSel(update.view)
      },
      pos: options.reduce((m, o) => Math.min(m, o.start), 1e9),
      style: "autocomplete"
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

class Autocomplete extends ViewPlugin {
  stateVersion = 0
  debounce = -1

  constructor(readonly view: EditorView) {
    super()
  }

  update(update: ViewUpdate) {
    if (!(update.docChanged || update.selectionSet ||
          update.transactions.some(t => t.annotation(setActiveCompletion) !== undefined))) return
    this.stateVersion++
    if (this.debounce > -1) clearTimeout(this.debounce)
    let active = update.state.field(activeCompletion)
    this.debounce = active == "pending" ? setTimeout(() => this.startUpdate(), DebounceTime) : -1
  }

  startUpdate() {
    this.debounce = -1
    let version = this.stateVersion, state = this.view.state
    let config = state.facet(autocompleteConfig)
    Promise.resolve(config.completeAt(state, state.selection.primary.head)).then(result => {
      if (this.stateVersion != version || result.items.length == 0) return
      let tooltip = buildTooltip(result.items)
      this.view.dispatch(this.view.state.t().annotate(setActiveCompletion(new ActiveCompletion(result.items, 0, tooltip))))
    })
  }
}

const style = EditorView.theme({
  "tooltip.autocomplete": {
    fontFamily: "monospace",
    overflowY: "auto",
    maxHeight: "10em",
    listStyle: "none",
    margin: 0,
    padding: 0,

    "& > li": {
      cursor: "pointer",
      padding: "1px 1em 1px 3px"
    },

    "& > li[aria-selected]": {
      background_fallback: "#bdf",
      background: "Highlight",
      color_fallback: "white",
      color: "HighlightText"
    }
  }
})
