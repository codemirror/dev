import {Line} from "../../text"
import {EditorState} from "../../state"
import {EditorView, ViewCommand, ViewUpdate, ViewPlugin, Decoration, WidgetType} from "../../view"
import {combineConfig, Slot} from "../../extension"
import {StyleModule} from "style-mod"

type Range = {from: number, to: number}

const foldSlot = Slot.define<{fold?: readonly Range[],
                              unfold?: readonly Range[]}>()

function selectedLines(state: EditorState) {
  let lines: Line[] = []
  for (let {head} of state.selection.ranges) {
    if (lines.some(l => l.start <= head && l.end >= head)) continue
    lines.push(state.doc.lineAt(head))
  }
  return lines
}

export const foldCode: ViewCommand = view => {
  if (!view.plugin(foldPlugin)) return false
  let fold = []
  for (let line of selectedLines(view.state)) {
    let range = view.state.behavior(EditorState.foldable)
      .reduce<Range | null>((value, f) => value || f(view.state, line.start, line.end), null)
    if (range) fold.push(range)
  }
  if (!fold.length) return false
  view.dispatch(view.state.t().addMeta(foldSlot({fold})))
  return true
}

export const unfoldCode: ViewCommand = view => {
  let unfold: Range[] = [], plugin = view.plugin(foldPlugin)
  if (!plugin) return false
  for (let line of selectedLines(view.state)) {
    let folded = plugin.foldAt(line.end)
    if (folded) unfold.push(folded)
  }
  if (!unfold.length) return false
  view.dispatch(view.state.t().addMeta(foldSlot({unfold})))
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

const foldPlugin = new ViewPlugin(view => new FoldPlugin(view), [
  ViewPlugin.behavior(EditorView.decorations, (plugin: FoldPlugin) => plugin.decorations)
])

export const codeFolding = EditorView.extend.unique((configs: FoldConfig[]) => {
  return [
    foldPlugin.extension,
    foldConfigBehavior(combineConfig(configs, defaultConfig)),
    EditorView.extend.fallback(EditorView.styleModule(styles))
  ]
}, {})

type WidgetConfig = {config: Required<FoldConfig>, class: string, view: EditorView}

class FoldPlugin {
  decorations = Decoration.none
  widgetConfig: WidgetConfig

  constructor(readonly view: EditorView) {
    let config = view.behavior(foldConfigBehavior)
    this.widgetConfig = {config, class: this.placeholderClass, view}
  }

  get placeholderClass() {
    return this.view.cssClass("fold-placeholder") + " " + styles.placeholder
  }

  update(update: ViewUpdate) {
    this.decorations = this.decorations.map(update.changes)
    for (let tr of update.transactions) {
      let slot = tr.getMeta(foldSlot)
      if (slot) this.updateRanges(slot.fold || [], slot.unfold || [])
    }
    // Make sure widgets are redrawn with up-to-date classes
    if (update.themeChanged && this.placeholderClass != this.widgetConfig.class) {
      this.widgetConfig = {config: this.widgetConfig.config, class: this.placeholderClass, view: this.view}
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

  foldAt(lineEnd: number) {
    let iter = this.decorations.iter(lineEnd, lineEnd)
    let range: null | Range = null
    for (let next; next = iter.next();)
      if (!range || range.from > next.from || range.to < next.to)
        range = {from: next.from, to: next.to}
    return range
  }
}

class FoldWidget extends WidgetType<WidgetConfig> {
  ignoreEvents() { return false }

  toDOM() {
    let conf = this.value.config
    if (conf.placeholderDOM) return conf.placeholderDOM()
    let element = document.createElement("span")
    element.textContent = conf.placeholderText
    element.setAttribute("aria-role", "button")
    element.setAttribute("aria-label", "unfold code")
    element.title = "unfold"
    element.className = this.value.class
    element.onclick = event => {
      let {view} = this.value
      let line = view.state.doc.lineAt(view.posAtDOM(event.target as HTMLElement))
      let folded = view.plugin(foldPlugin)!.foldAt(line.end)
      if (folded) view.dispatch(view.state.t().addMeta(foldSlot({unfold: [folded]})))
      event.preventDefault()
    }
    return element
  }
}

const styles = new StyleModule({
  placeholder: {
    background: "#eee",
    border: "1px solid silver",
    color: "#888",
    borderRadius: ".2em",
    margin: "0 1px",
    padding: "0 1px",
    cursor: "pointer"
  }
})
