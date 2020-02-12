import {combineConfig, fillConfig, EditorState, Annotation, Facet, StateField} from "../../state"
import {EditorView, BlockInfo, Command, Decoration, DecorationSet, WidgetType, themeClass} from "../../view"
import {gutter, GutterMarker} from "../../gutter"

type Range = {from: number, to: number}

const foldAnnotation = Annotation.define<{fold?: readonly Range[],
                                          unfold?: readonly Range[]}>()

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
    let ann = tr.annotation(foldAnnotation)
    if (ann) {
      let {fold = [], unfold = []} = ann
      if (unfold.length || fold.length)
        folded = folded.update({
          add: fold.map(({from, to}) => Decoration.replace(from, to, FoldWidget.config)),
          filter: (from, to) => !unfold.some(r => r.from == from && r.to == to),
          filterFrom: unfold.reduce((m, r) => Math.min(m, r.from), 1e8),
          filterTo: unfold.reduce((m, r) => Math.max(m, r.to), 0)
        })
    }
    return folded
  }
}).provide(EditorView.decorations)

function foldInside(state: EditorState, from: number, to: number) {
  let found: {from: number, to: number} | null = null
  state.field(foldState, false)?.between(from, to, (from, to) => {
    if (!found || found.from > from) found = ({from, to})
  })
  return found
}

export const foldCode: Command = view => {
  if (!view.state.field(foldState, false)) return false
  let fold = []
  for (let line of selectedLines(view)) {
    let range = view.state.facet(EditorState.foldable)
      .reduce<Range | null>((value, f) => value || f(view.state, line.from, line.to), null)
    if (range) fold.push(range)
  }
  if (!fold.length) return false
  view.dispatch(view.state.t().annotate(foldAnnotation, {fold}))
  return true
}

export const unfoldCode: Command = view => {
  if (!view.state.field(foldState, false)) return false
  let unfold: Range[] = []
  for (let line of selectedLines(view)) {
    let folded = foldInside(view.state, line.from, line.to)
    if (folded) unfold.push(folded)
  }
  if (!unfold.length) return false
  view.dispatch(view.state.t().annotate(foldAnnotation, {unfold}))
  return true
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
    let conf = view.state.facet(foldConfig)
    if (conf.placeholderDOM) return conf.placeholderDOM()
    let element = document.createElement("span")
    element.textContent = conf.placeholderText
    // FIXME should this have a role? does it make sense to allow focusing by keyboard?
    element.setAttribute("aria-label", view.phrase("folded code"))
    element.title = view.phrase("unfold")
    element.className = themeClass("foldPlaceholder")

    element.onclick = event => {
      let line = view.lineAt(view.posAtDOM(event.target as HTMLElement))
      let folded = foldInside(view.state, line.from, line.to)
      if (folded) view.dispatch(view.state.t().annotate(foldAnnotation, {unfold: [folded]}))
      event.preventDefault()
    }
    return element
  }

  static config = {widget: new FoldWidget(null)}
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
    span.title = view.phrase(this.open ? "Fold line" : "Unfold line")
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
            view.dispatch(view.state.t().annotate(foldAnnotation, {unfold: [folded]}))
            return true
          }
          let range = view.state.facet(EditorState.foldable)
            .reduce<Range | null>((value, f) => value || f(view.state, line.from, line.to), null)
          if (range) {
            view.dispatch(view.state.t().annotate(foldAnnotation, {fold: [range]}))
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
