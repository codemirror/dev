import {combineConfig, EditorState, StateEffect, ChangeDesc, Facet,
        StateField, Extension} from "@codemirror/next/state"
import {EditorView, BlockInfo, Command, Decoration, DecorationSet, WidgetType, themeClass,
        KeyBinding, ViewPlugin, ViewUpdate} from "@codemirror/next/view"
import {foldable} from "@codemirror/next/language"
import {gutter, GutterMarker} from "@codemirror/next/gutter"
import {Range, RangeSet} from "@codemirror/next/rangeset"

type DocRange = {from: number, to: number}

function mapRange(range: DocRange, mapping: ChangeDesc) {
  let from = mapping.mapPos(range.from, 1), to = mapping.mapPos(range.to, -1)
  return from >= to ? undefined : {from, to}
}

const foldEffect = StateEffect.define<DocRange>({map: mapRange})
const unfoldEffect = StateEffect.define<DocRange>({map: mapRange})

function selectedLines(view: EditorView) {
  let lines: BlockInfo[] = []
  for (let {head} of view.state.selection.ranges) {
    if (lines.some(l => l.from <= head && l.to >= head)) continue
    lines.push(view.visualLineAt(head))
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
      if (e.is(foldEffect) && !foldExists(folded, e.value.from, e.value.to))
        folded = folded.update({add: [foldWidget.range(e.value.from, e.value.to)]})
      else if (e.is(unfoldEffect)) {
        folded = folded.update({filter: (from, to) => e.value.from != from || e.value.to != to,
                                filterFrom: e.value.from, filterTo: e.value.to})
      }
    }
    // Clear folded ranges that cover the selection head
    if (tr.selection) {
      let onSelection = false, {head} = tr.selection.main
      folded.between(head, head, (a, b) => { if (a < head && b > head) onSelection = true })
      if (onSelection) folded = folded.update({
        filterFrom: head,
        filterTo: head,
        filter: (a, b) => b <= head || a >= head
      })
    }
    return folded
  },
  provide: f => EditorView.decorations.compute([f], s => s.field(f))
})

function foldInside(state: EditorState, from: number, to: number) {
  let found: {from: number, to: number} | null = null
  state.field(foldState, false)?.between(from, to, (from, to) => {
    if (!found || found.from > from) found = ({from, to})
  })
  return found
}

function foldExists(folded: DecorationSet, from: number, to: number) {
  let found = false
  folded.between(from, from, (a, b) => { if (a == from && b == to) found = true })
  return found
}

function maybeEnable(state: EditorState) {
  return state.field(foldState, false) ? undefined : {append: codeFolding()}
}

/// Fold the lines that are selected, if possible.
export const foldCode: Command = view => {
  for (let line of selectedLines(view)) {
    let range = foldable(view.state, line.from, line.to)
    if (range) {
      view.dispatch({effects: foldEffect.of(range),
                     reconfigure: maybeEnable(view.state)})
      return true
    }
  }
  return false
}

/// Unfold folded ranges on selected lines.
export const unfoldCode: Command = view => {
  if (!view.state.field(foldState, false)) return false
  let effects = []
  for (let line of selectedLines(view)) {
    let folded = foldInside(view.state, line.from, line.to)
    if (folded) effects.push(unfoldEffect.of(folded))
  }
  if (effects.length) view.dispatch({effects})
  return effects.length > 0
}

/// Fold all top-level foldable ranges.
export const foldAll: Command = view => {
  let {state} = view, effects = []
  for (let pos = 0; pos < state.doc.length;) {
    let line = view.visualLineAt(pos), range = foldable(state, line.from, line.to)
    if (range) effects.push(foldEffect.of(range))
    pos = (range ? view.visualLineAt(range.to) : line).to + 1
  }
  if (effects.length) view.dispatch({effects, reconfigure: maybeEnable(view.state)})
  return !!effects.length
}

/// Unfold all folded code.
export const unfoldAll: Command = view => {
  let field = view.state.field(foldState, false)
  if (!field || !field.size) return false
  let effects: StateEffect<any>[] = []
  field.between(0, view.state.doc.length, (from, to) => { effects.push(unfoldEffect.of({from, to})) })
  view.dispatch({effects})
  return true
}

/// Default fold-related key bindings.
///
///  - Ctrl-Shift-[ (Cmd-Alt-[ on macOS): [`foldCode`](#fold.foldCode).
///  - Ctrl-Shift-] (Cmd-Alt-] on macOS): [`unfoldCode`](#fold.unfoldCode).
///  - Ctrl-Alt-[: [`foldAll`](#fold.foldAll).
///  - Ctrl-Alt-]: [`unfoldAll`](#fold.unfoldAll).
export const foldKeymap: readonly KeyBinding[] = [
  {key: "Ctrl-Shift-[", mac: "Cmd-Alt-[", run: foldCode},
  {key: "Ctrl-Shift-]", mac: "Cmd-Alt-]", run: unfoldCode},
  {key: "Ctrl-Alt-[", run: foldAll},
  {key: "Ctrl-Alt-]", run: unfoldAll}
]

interface FoldConfig {
  /// A function that creates the DOM element used to indicate the
  /// position of folded code. When not given, the `placeholderText`
  /// option will be used instead.
  placeholderDOM?: (() => HTMLElement) | null,
  /// Text to use as placeholder for folded text. Defaults to `"…"`.
  /// Will be styled with the `$foldPlaceholder` theme class.
  placeholderText?: string
}

const defaultConfig: Required<FoldConfig> = {
  placeholderDOM: null,
  placeholderText: "…"
}

const foldConfig = Facet.define<FoldConfig, Required<FoldConfig>>({
  combine(values) { return combineConfig(values, defaultConfig) }
})

/// Create an extension that configures code folding.
export function codeFolding(config?: FoldConfig): Extension {
  let result = [foldState, baseTheme]
  if (config) result.push(foldConfig.of(config))
  return result
}

const foldWidget = Decoration.replace({widget: new class extends WidgetType {
  ignoreEvents() { return false }

  toDOM(view: EditorView) {
    let {state} = view, conf = state.facet(foldConfig)
    if (conf.placeholderDOM) return conf.placeholderDOM()
    let element = document.createElement("span")
    element.textContent = conf.placeholderText
    element.setAttribute("aria-label", state.phrase("folded code"))
    element.title = state.phrase("unfold")
    element.className = themeClass("foldPlaceholder")

    element.onclick = event => {
      let line = view.visualLineAt(view.posAtDOM(event.target as HTMLElement))
      let folded = foldInside(view.state, line.from, line.to)
      if (folded) view.dispatch({effects: unfoldEffect.of(folded)})
      event.preventDefault()
    }
    return element
  }
}})

interface FoldGutterConfig {
  /// Text used to indicate that a given line can be folded. Defaults
  /// to `"⌄"`.
  openText?: string
  /// Text used to indicate that a given line is folded. Defaults to
  /// `"›"`.
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

/// Create an extension that registers a fold gutter, which shows a
/// fold status indicator before foldable lines (which can be clicked
/// to fold or unfold the line).
export function foldGutter(config: FoldGutterConfig = {}): Extension {
  let fullConfig = {...foldGutterDefaults, ...config}
  let canFold = new FoldMarker(fullConfig, true), canUnfold = new FoldMarker(fullConfig, false)

  let markers = ViewPlugin.fromClass(class {
    markers: RangeSet<FoldMarker>
    from: number
    constructor(view: EditorView) {
      this.from = view.viewport.from
      this.markers = RangeSet.of(this.buildMarkers(view))
    }
    update(update: ViewUpdate) {
      let firstChange = -1
      update.changes.iterChangedRanges(from => { if (firstChange < 0) firstChange = from })
      let foldChange = update.startState.field(foldState, false) != update.state.field(foldState, false)
      if (!foldChange && update.docChanged && update.view.viewport.from == this.from && firstChange > this.from) {
        let start = update.view.visualLineAt(firstChange).from
        this.markers = this.markers.update({
          filter: () => false,
          filterFrom: start,
          add: this.buildMarkers(update.view, start)
        })
      } else if (foldChange || update.docChanged || update.viewportChanged) {
        this.from = update.view.viewport.from
        this.markers = RangeSet.of(this.buildMarkers(update.view))
      }
    }
    buildMarkers(view: EditorView, from = 0) {
      let ranges: Range<FoldMarker>[] = []
      view.viewportLines(line => {
        if (line.from >= from) {
          let mark = foldInside(view.state, line.from, line.to) ? canUnfold
            : foldable(view.state, line.from, line.to) ? canFold : null
          if (mark) ranges.push(mark.range(line.from))
        }
      })
      return ranges
    }
  })

  return [
    markers,
    gutter({
      style: "foldGutter",
      markers(view) { return view.plugin(markers)?.markers || RangeSet.empty },
      initialSpacer() {
        return new FoldMarker(fullConfig, false)
      },
      domEventHandlers: {
        click: (view, line) => {
          let folded = foldInside(view.state, line.from, line.to)
          if (folded) {
            view.dispatch({effects: unfoldEffect.of(folded)})
            return true
          }
          let range = foldable(view.state, line.from, line.to)
          if (range) {
            view.dispatch({effects: foldEffect.of(range)})
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
  $foldPlaceholder: {
    backgroundColor: "#eee",
    border: "1px solid #ddd",
    color: "#888",
    borderRadius: ".2em",
    margin: "0 1px",
    padding: "0 1px",
    cursor: "pointer"
  },

  "$gutterElement.foldGutter": {
    padding: "0 1px",
    cursor: "pointer"
  }
})
