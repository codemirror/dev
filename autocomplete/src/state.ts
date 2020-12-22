import {EditorView} from "@codemirror/next/view"
import {Transaction, StateField, StateEffect, EditorState, ChangeDesc} from "@codemirror/next/state"
import {Tooltip, showTooltip} from "@codemirror/next/tooltip"
import {Option, CompletionSource, CompletionResult, cur, asSource, Completion} from "./completion"
import {FuzzyMatcher} from "./filter"
import {completionTooltip} from "./tooltip"
import {CompletionConfig, completionConfig} from "./config"

const MaxOptions = 300

function sortOptions(active: readonly ActiveSource[], state: EditorState) {
  let options = []
  for (let a of active) if (a.hasResult()) {
    let matcher = new FuzzyMatcher(state.sliceDoc(a.from, a.to)), match
    for (let option of a.result.options) if (match = matcher.match(option.label)) {
      if (option.boost != null) match[0] += option.boost
      options.push(new Option(option, a, match))
    }
  }
  options.sort(cmpOption)
  return options.length > MaxOptions ? options.slice(0, MaxOptions) : options
}

class CompletionDialog {
  constructor(readonly options: readonly Option[],
              readonly attrs: {[name: string]: string},
              readonly tooltip: readonly [Tooltip],
              readonly timestamp: number,
              readonly selected: number) {}

  setSelected(selected: number, id: string) {
    return selected == this.selected || selected >= this.options.length ? this
      : new CompletionDialog(this.options, makeAttrs(id, selected), this.tooltip, this.timestamp, selected)
  }

  static build(
    active: readonly ActiveSource[],
    state: EditorState,
    id: string,
    prev: CompletionDialog | null
  ): CompletionDialog | null {
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
      create: completionTooltip(completionState)
    }], prev ? prev.timestamp : Date.now(), selected)
  }

  map(changes: ChangeDesc) {
    return new CompletionDialog(this.options, this.attrs, [{...this.tooltip[0], pos: changes.mapPos(this.tooltip[0].pos)}],
                                this.timestamp, this.selected)
  }
}

export class CompletionState {
  constructor(readonly active: readonly ActiveSource[],
              readonly id: string,
              readonly open: CompletionDialog | null) {}

  static start() {
    return new CompletionState(none, "cm-ac-" + Math.floor(Math.random() * 2e6).toString(36), null)
  }

  update(tr: Transaction) {
    let {state} = tr, conf = state.facet(completionConfig)
    let sources = conf.override ||
      state.languageDataAt<CompletionSource | readonly (string | Completion)[]>("autocomplete", cur(state)).map(asSource)
    let active: readonly ActiveSource[] = sources.map(source => {
      let value = this.active.find(s => s.source == source) || new ActiveSource(source, State.Inactive, false)
      return value.update(tr, conf)
    })
    if (active.length == this.active.length && active.every((a, i) => a == this.active[i])) active = this.active

    let open = tr.selection || active.some(a => a.hasResult() && tr.changes.touchesRange(a.from, a.to)) ||
      !sameResults(active, this.active) ? CompletionDialog.build(active, state, this.id, this.open)
      : this.open && tr.docChanged ? this.open.map(tr.changes) : this.open
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

export const enum State { Inactive = 0, Pending = 1, Result = 2 }

export class ActiveSource {
  constructor(readonly source: CompletionSource,
              readonly state: State,
              readonly explicit: boolean) {}

  hasResult(): this is ActiveResult { return false }

  update(tr: Transaction, conf: Required<CompletionConfig>): ActiveSource {
    let event = tr.annotation(Transaction.userEvent), value: ActiveSource = this
    if (event == "input" || event == "delete")
      value = value.handleUserEvent(tr, event, conf)
    else if (tr.docChanged)
      value = value.handleChange(tr)
    else if (tr.selection && value.state != State.Inactive)
      value = new ActiveSource(value.source, State.Inactive, false)

    for (let effect of tr.effects) {
      if (effect.is(startCompletionEffect))
        value = new ActiveSource(value.source, State.Pending, effect.value)
      else if (effect.is(closeCompletionEffect))
        value = new ActiveSource(value.source, State.Inactive, false)
      else if (effect.is(setActiveEffect))
        for (let active of effect.value) if (active.source == value.source) value = active
    }
    return value
  }

  handleUserEvent(_tr: Transaction, type: "input" | "delete", conf: Required<CompletionConfig>): ActiveSource {
    return type == "delete" || !conf.activateOnTyping ? this : new ActiveSource(this.source, State.Pending, false)
  }

  handleChange(tr: Transaction): ActiveSource {
    return tr.changes.touchesRange(cur(tr.startState)) ? new ActiveSource(this.source, State.Inactive, false) : this
  }
}

export class ActiveResult extends ActiveSource {
  constructor(source: CompletionSource,
              explicit: boolean,
              readonly result: CompletionResult,
              readonly from: number,
              readonly to: number,
              readonly span: RegExp | null) {
    super(source, State.Result, explicit)
  }

  hasResult(): this is ActiveResult { return true }

  handleUserEvent(tr: Transaction, type: "input" | "delete", conf: Required<CompletionConfig>): ActiveSource {
    let from = tr.changes.mapPos(this.from), to = tr.changes.mapPos(this.to, 1)
    let pos = cur(tr.state)
    if ((this.explicit ? pos < from : pos <= from) || pos > to)
      return new ActiveSource(this.source, type == "input" && conf.activateOnTyping ? State.Pending : State.Inactive, false)
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

export const startCompletionEffect = StateEffect.define<boolean>()
export const closeCompletionEffect = StateEffect.define<null>()
export const setActiveEffect = StateEffect.define<readonly ActiveSource[]>({
  map(sources, mapping) { return sources.map(s => s.hasResult() && !mapping.empty ? s.map(mapping) : s) }
})
export const setSelectedEffect = StateEffect.define<number>()

export const completionState = StateField.define<CompletionState>({
  create() { return CompletionState.start() },

  update(value, tr) { return value.update(tr) },

  provide: f => [
    showTooltip.computeN([f], state => state.field(f).tooltip),
    EditorView.contentAttributes.from(f, state => state.attrs)
  ]
})
