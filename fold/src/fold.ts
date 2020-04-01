import {combineConfig, fillConfig, EditorState, StateEffect, Mapping, Facet, StateField, Transaction} from "@codemirror/next/state"
import {EditorView, BlockInfo, Command, Decoration, DecorationSet, WidgetType, themeClass} from "@codemirror/next/view"
import {gutter, GutterMarker} from "@codemirror/next/gutter"

type Range = {from: number, to: number}

function mapRange(range: Range, mapping: Mapping) {
  let from = mapping.mapPos(range.from, 1), to = mapping.mapPos(range.to, -1)
  return from >= to ? undefined : {from, to}
}

const foldEffect = StateEffect.define<Range>({map: mapRange})
const unfoldEffect = StateEffect.define<Range>({map: mapRange})

function selectedLines(view: EditorView) {
  let lines: BlockInfo[] = []
  for (let {head} of view.state.selection.ranges) {
    if (lines.some(l => l.from <= head && l.to >= head)) continue
    lines.push(view.lineAt(head))
  }
  return lines
}

const foldState = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(folded, tr) {
    folded = folded.map(tr.changes)
    for (let e of tr.effects) {
      if (e.is(foldEffect))
        folded = folded.update({add: [FoldWidget.decoration.range(e.value.from, e.value.to)]})
      else if (e.is(unfoldEffect)) {
        folded = folded.update({filter: (from, to) => e.value.from != from || e.value.to != to,
                                filterFrom: e.value.from, filterTo: e.value.to})
      }
    }
    return folded
  },
  provide: [EditorView.decorations]
})

function foldInside(state: EditorState, from: number, to: number) {
  let found: {from: number, to: number} | null = null
  state.field(foldState, false)?.between(from, to, (from, to) => {
    if (!found || found.from > from) found = ({from, to})
  })
  return found
}

export const foldCode: Command = view => {
  if (!view.state.field(foldState, false)) return false
  for (let line of selectedLines(view)) {
    let range = view.state.facet(EditorState.foldable)
      .reduce<Range | null>((value, f) => value || f(view.state, line.from, line.to), null)
    if (range) {
      view.dispatch(view.state.t().effect(foldEffect.of(range)))
      return true
    }
  }
  return false
}

export const unfoldCode: Command = view => {
  if (!view.state.field(foldState, false)) return false
  let tr: Transaction | null = null
  for (let line of selectedLines(view)) {
    let folded = foldInside(view.state, line.from, line.to)
    if (folded) (tr || (tr = view.state.t())).effect(unfoldEffect.of(folded))
  }
  if (tr) view.dispatch(tr)
  return !!tr
}

export interface FoldConfig {
  placeholderDOM?: (() => HTMLElement) | null,
  placeholderText?: string
}

const defaultConfig: Required<FoldConfig> = {
  placeholderDOM: null,
  placeholderText: "…"
}

const foldConfig = Facet.define<FoldConfig, Required<FoldConfig>>({
  combine(values) { return combineConfig(values, defaultConfig) }
})

export function codeFolding(config: FoldConfig = {}) {
  return [
    foldConfig.of(config),
    foldState,
    baseTheme
  ]
}

class FoldWidget extends WidgetType<null> {
  ignoreEvents() { return false }

  toDOM(view: EditorView) {
    let {state} = view, conf = state.facet(foldConfig)
    if (conf.placeholderDOM) return conf.placeholderDOM()
    let element = document.createElement("span")
    element.textContent = conf.placeholderText
    // FIXME should this have a role? does it make sense to allow focusing by keyboard?
    element.setAttribute("aria-label", state.phrase("folded code"))
    element.title = state.phrase("unfold")
    element.className = themeClass("foldPlaceholder")

    element.onclick = event => {
      let line = view.lineAt(view.posAtDOM(event.target as HTMLElement))
      let folded = foldInside(view.state, line.from, line.to)
      if (folded) view.dispatch(view.state.t().effect(unfoldEffect.of(folded)))
      event.preventDefault()
    }
    return element
  }

  static decoration = Decoration.replace({widget: new FoldWidget(null)})
}

export interface FoldGutterConfig {
  openText?: string
  closedText?: string
}

const foldGutterDefaults: Required<FoldGutterConfig> = {
  openText: "⌄",
  closedText: "›"
}

class FoldMarker extends GutterMarker {
  constructor(readonly config: Required<FoldGutterConfig>,
              readonly open: boolean) { super() }

  eq(other: FoldMarker) { return this.config == other.config && this.open == other.open }

  toDOM(view: EditorView) {
    let span = document.createElement("span")
    span.textContent = this.open ? this.config.openText : this.config.closedText
    span.title = view.state.phrase(this.open ? "Fold line" : "Unfold line")
    return span
  }
}

export function foldGutter(config: FoldGutterConfig = {}) {
  let fullConfig = fillConfig(config, foldGutterDefaults)
  return [
    gutter({
      style: "foldGutter",
      lineMarker(view, line) {
        // FIXME optimize this. At least don't run it for updates that
        // don't change anything relevant
        let folded = foldInside(view.state, line.from, line.to)
        if (folded) return new FoldMarker(fullConfig, false)
        if (view.state.facet(EditorState.foldable).some(f => f(view.state, line.from, line.to)))
          return new FoldMarker(fullConfig, true)
        return null
      },
      initialSpacer() {
        return new FoldMarker(fullConfig, false)
      },
      domEventHandlers: {
        click: (view, line) => {
          let folded = foldInside(view.state, line.from, line.to)
          if (folded) {
            view.dispatch(view.state.t().effect(unfoldEffect.of(folded)))
            return true
          }
          let range = view.state.facet(EditorState.foldable)
            .reduce<Range | null>((value, f) => value || f(view.state, line.from, line.to), null)
          if (range) {
            view.dispatch(view.state.t().effect(foldEffect.of(range)))
            return true
          }
          return false
        }
      }
    }),
    codeFolding()
  ]
}

const baseTheme = EditorView.baseTheme({
  foldPlaceholder: {
    background: "#eee",
    border: "1px solid silver",
    color: "#888",
    borderRadius: ".2em",
    margin: "0 1px",
    padding: "0 1px",
    cursor: "pointer"
  },

  "gutterElement.foldGutter": {
    padding: "0 1px",
    cursor: "pointer"
  }
})
