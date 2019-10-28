import {EditorState, Annotation} from "../../state"
import {EditorView, BlockInfo, Command, ViewUpdate, ViewPlugin, Decoration, WidgetType} from "../../view"
import {combineConfig, fillConfig} from "../../extension"
import {Gutter, GutterMarker} from "../../gutter"

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

export const foldCode: Command = view => {
  if (!view.plugin(foldPlugin)) return false
  let fold = []
  for (let line of selectedLines(view)) {
    let range = view.state.behavior(EditorState.foldable)
      .reduce<Range | null>((value, f) => value || f(view.state, line.from, line.to), null)
    if (range) fold.push(range)
  }
  if (!fold.length) return false
  view.dispatch(view.state.t().annotate(foldAnnotation({fold})))
  return true
}

export const unfoldCode: Command = view => {
  let unfold: Range[] = [], plugin = view.plugin(foldPlugin)
  if (!plugin) return false
  for (let line of selectedLines(view)) {
    let folded = plugin.foldInside(line.from, line.to)
    if (folded) unfold.push(folded)
  }
  if (!unfold.length) return false
  view.dispatch(view.state.t().annotate(foldAnnotation({unfold})))
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

const foldConfigBehavior = EditorView.extend.behavior<Required<FoldConfig>, Required<FoldConfig>>({
  combine(values) { return values.length ? values[0] : defaultConfig }
})

;(window as any).beh = foldConfigBehavior

const foldPlugin = ViewPlugin.create(view => new FoldPlugin(view)).decorations(p => p.decorations)

export const codeFolding = EditorView.extend.unique((configs: FoldConfig[]) => {
  return [
    foldPlugin.extension,
    foldConfigBehavior(combineConfig(configs, defaultConfig)),
    EditorView.extend.fallback(EditorView.theme(defaultStyle))
  ]
}, {})

type WidgetConfig = {config: Required<FoldConfig>, class: string}

class FoldPlugin {
  decorations = Decoration.none
  widgetConfig: WidgetConfig

  constructor(readonly view: EditorView) {
    let config = view.behavior(foldConfigBehavior)
    this.widgetConfig = {config, class: this.placeholderClass}
  }

  get placeholderClass() {
    return this.view.cssClass("foldPlaceholder")
  }

  update(update: ViewUpdate) {
    this.decorations = this.decorations.map(update.changes)
    for (let tr of update.transactions) {
      let ann = tr.annotation(foldAnnotation)
      if (ann) this.updateRanges(ann.fold || [], ann.unfold || [])
    }
    // Make sure widgets are redrawn with up-to-date classes
    if (update.themeChanged && this.placeholderClass != this.widgetConfig.class) {
      this.widgetConfig = {config: this.widgetConfig.config, class: this.placeholderClass}
      let deco = [], iter = this.decorations.iter(), next
      while (next = iter.next()) deco.push(Decoration.replace(next.from, next.to, {widget: new FoldWidget(this.widgetConfig)}))
      this.decorations = Decoration.set(deco)
    }
  }

  updateRanges(add: readonly Range[], remove: readonly Range[]) {
    this.decorations = this.decorations.update(
      add.map(({from, to}) => Decoration.replace(from, to, {widget: new FoldWidget(this.widgetConfig)})),
      remove.length ? (from, to) => !remove.some(r => r.from == from && r.to == to) : null,
      remove.reduce((m, r) => Math.min(m, r.from), 1e8),
      remove.reduce((m, r) => Math.max(m, r.to), 0))
  }

  foldInside(from: number, to: number) {
    let found = null
    this.decorations.between(from, to, (from, to) => found = ({from, to}))
    return found
  }
}

class FoldWidget extends WidgetType<WidgetConfig> {
  ignoreEvents() { return false }

  toDOM(view: EditorView) {
    let conf = this.value.config
    if (conf.placeholderDOM) return conf.placeholderDOM()
    let element = document.createElement("span")
    element.textContent = conf.placeholderText
    // FIXME should this have a role? does it make sense to allow focusing by keyboard?
    element.setAttribute("aria-label", view.phrase("folded code"))
    element.title = view.phrase("unfold")
    element.className = this.value.class
    element.onclick = event => {
      let line = view.lineAt(view.posAtDOM(event.target as HTMLElement))
      let folded = view.plugin(foldPlugin)!.foldInside(line.from, line.to)
      if (folded) view.dispatch(view.state.t().annotate(foldAnnotation({unfold: [folded]})))
      event.preventDefault()
    }
    return element
  }
}

export interface FoldGutterConfig {
  openText?: string
  closedText?: string
}

const foldGutterDefaults: Required<FoldGutterConfig> = {
  openText: "▼",
  closedText: "▶"
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
    new Gutter({
      style: "foldGutter",
      lineMarker(view, line) {
        // FIXME optimize this. At least don't run it for updates that
        // don't change anything relevant
        let plugin = view.plugin(foldPlugin)!
        let folded = plugin.foldInside(line.from, line.to)
        if (folded) return new FoldMarker(fullConfig, false)
        if (view.state.behavior(EditorState.foldable).some(f => f(view.state, line.from, line.to)))
          return new FoldMarker(fullConfig, true)
        return null
      },
      initialSpacer() {
        return new FoldMarker(fullConfig, false)
      },
      handleDOMEvents: {
        click: (view, line) => {
          let plugin = view.plugin(foldPlugin)!
          let folded = plugin.foldInside(line.from, line.to)
          if (folded) {
            view.dispatch(view.state.t().annotate(foldAnnotation({unfold: [folded]})))
            return true
          }
          let range = view.state.behavior(EditorState.foldable)
            .reduce<Range | null>((value, f) => value || f(view.state, line.from, line.to), null)
          if (range) {
            view.dispatch(view.state.t().annotate(foldAnnotation({fold: [range]})))
            return true
          }
          return false
        }
      }
    }).extension,
    codeFolding()
  ]
}

const defaultStyle = {
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
}
