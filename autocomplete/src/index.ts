import {ViewPlugin, ViewPluginValue, ViewUpdate, EditorView} from "../../view"
import {Annotation, CancellablePromise, EditorSelection, EditorState, Transaction} from "../../state"
import {combineConfig, Extension} from "../../extension"
import {keymap} from "../../keymap"
import {Tooltip, tooltips, showTooltip} from "../../tooltip"

export interface AutocompleteData {
  completeAt: (state: EditorState, pos: number) => CompletionResult | CancellablePromise<CompletionResult>
}

export interface CompletionResult {
  start: number,
  items: ReadonlyArray<CompletionResultItem>
}

export interface CompletionResultItem {
  label: string,
  insertText?: string
}

export function completeFromSyntax(state: EditorState, pos: number): CompletionResult | CancellablePromise<CompletionResult> | null {
  let syntax = state.behavior(EditorState.syntax)
  if (syntax.length == 0) return null
  let {completeAt} = syntax[0].languageDataAt<AutocompleteData>(state, pos)
  return completeAt ? completeAt(state, pos) : null
}

export function sortAndFilterCompletion(substr: string, items: ReadonlyArray<CompletionResultItem>) {
  const startMatch = [], inMatch = []
  for (const item of items) {
    // FIXME: separate key
    if (item.label.startsWith(substr)) startMatch.push(item)
    else if (item.label.includes(substr)) inMatch.push(item)
  }
  return startMatch.concat(inMatch)
}

const autocompleteConfig = EditorView.extend.behavior<Partial<AutocompleteData>, AutocompleteData>({
  combine(configs) {
    return combineConfig(configs, {
      completeAt(state: EditorState, pos: number) {
        return completeFromSyntax(state, pos) || {start: pos, items: []}
      }
    })
  }
})

export function autocomplete(config: Partial<AutocompleteData> = {}): Extension {
  const autocompletePlugin = ViewPlugin.create(view => new Autocomplete(view))
    .behavior(showTooltip, p => p.tooltip)
  return [
    autocompleteConfig(config),
    autocompletePlugin.extension,
    EditorView.extend.fallback(style),
    tooltips(),
    keymap({
      ArrowDown(view: EditorView) {
        let autocomplete = view.plugin(autocompletePlugin)
        return autocomplete ? autocomplete.moveSelection(1) : false
      },
      ArrowUp(view: EditorView) {
        let autocomplete = view.plugin(autocompletePlugin)
        return autocomplete ? autocomplete.moveSelection(-1) : false
      },
      Enter(view: EditorView) {
        let autocomplete = view.plugin(autocompletePlugin)
        return autocomplete ? autocomplete.accept() : false
      }
    }),
  ]
}

const moveSelection = Annotation.define<-1 | 1>()

class AutocompletionState {
  private constructor(
    private readonly start: number,
    private readonly end: number,
    readonly items: ReadonlyArray<CompletionResultItem>,
    readonly tooltip: Tooltip,
    private readonly _selected: number | null = null
  ) {}

  get selected() { return this._selected !== null ? this._selected : 0 }

  accept(view: EditorView, i: number = this.selected) {
    let item = this.items[i]
    let text = item.insertText || item.label
    view.dispatch(view.state.t().replace(this.start, this.end, text).setSelection(EditorSelection.single(this.start + text.length)))
    view.focus()
  }

  update(newStart: number, newEnd: number, newItems: ReadonlyArray<CompletionResultItem>, newTooltip: Tooltip) {
    let selected = null
    if (this._selected !== null) {
      let target = this.items[this._selected].label
      let i = 0
      for (; i < newItems.length; ++i) {
        if (newItems[i].label == target) break
      }
      if (i < newItems.length) selected = i
    }
    return new AutocompletionState(newStart, newEnd, newItems, newTooltip, selected)
  }

  moveSelection(dir: -1 | 1) {
    let next = this.selected + dir
    if (dir == 1 && next > this.items.length - 1) next = 0
    else if (dir == -1 && next < 0) next = this.items.length - 1
    return new AutocompletionState(this.start, this.end, this.items, this.tooltip, next)
  }

  static fromOrNew(oldState: AutocompletionState | null, start: number, end: number, items: ReadonlyArray<CompletionResultItem>, tooltip: Tooltip) {
    return oldState ? oldState.update(start, end, items, tooltip) : new AutocompletionState(start, end, items, tooltip)
  }
}

class Autocomplete implements ViewPluginValue {
  private readonly config: AutocompleteData;
  private dom: HTMLElement;
  private _state: AutocompletionState | null = null;

  get tooltip() { return this._state && this._state.tooltip }

  constructor(
    private readonly view: EditorView) {
    this.config = view.behavior(autocompleteConfig)
    this.dom = document.createElement("div")
    const ul = document.createElement("ul")
    ul.setAttribute("role", "listbox")
    this.dom.appendChild(ul)
  }

  update(update: ViewUpdate) {
    let selectionMoved = update.annotation(moveSelection)
    if (selectionMoved) {
      if (!this._state) return
      const ul = this.dom.firstChild as any as HTMLElement
      ul.children[this._state.selected].className = ""
      this._state = this._state.moveSelection(selectionMoved)
      const li = ul.children[this._state.selected]
      li.className = "selected"
      li.scrollIntoView()
      return
    }

    if (!update.docChanged) {
      if (update.transactions.some(tr => tr.selectionSet)) this._state = null
      return
    }

    const source = update.annotation(Transaction.userEvent)
    if (source != "keyboard" && typeof source != "undefined") {
      this._state = null
      return
    }

    const end = update.state.selection.primary.anchor
    let result = this.config.completeAt(this.view.state, end)
    if ("then" in result) {
      result.then(res => {
        if (!(result as CancellablePromise<CompletionResult>).canceled) this.handleResult(res, end)
      })
      this.view.waitFor(result)
    } else this.handleResult(result, end)
  }

  private handleResult({items, start}: CompletionResult, end: number) {
    if (items.length == 0) {
      this._state = null
      return
    }
    const tooltip = {dom: this.dom, pos: start, style: "autocomplete"}
    this._state = AutocompletionState.fromOrNew(this._state, start, end, items, tooltip)
    this.updateList()
  }

  moveSelection(dir: -1 | 1) {
    if (!this._state) return false
    this.view.dispatch(this.view.state.t().annotate(moveSelection(dir)))
    return true
  }

  accept() {
    if (!this._state) return false
    this._state.accept(this.view)
    return true
  }

  private updateList() {
    const ul = this.dom.firstChild as any as HTMLUListElement
    while (ul.lastChild) ul.lastChild.remove()
    for (const [i, v] of this._state!.items.entries()) {
      const li = document.createElement("li")
      li.innerText = v.label
      li.setAttribute("role", "option")
      if (i === this._state!.selected) li.className = "selected"
      li.addEventListener("click", e => this._state!.accept(this.view, i))
      ul.appendChild(li)
    }
  }

  destroy() {
    this.dom = null as any
    this._state = null as any
  }
}

const style = EditorView.theme({
  "tooltip.autocomplete": {
    fontFamily: "monospace",
    margin: "-2px 0px 0px -2px",
    maxHeight: "10em",
    overflowY: "auto",

    "& > ul": {
      listStyle: "none",
      margin: 0,
      padding: 0,

      "& > li": {
        paddingRight: "1em", // For a scrollbar
        cursor: "pointer",
      },

      "& > li.selected": {
        backgroundColor: "lightblue"
      },
    }
  }
})
