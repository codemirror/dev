import {combineConfig, fillConfig, EditorState, StateEffect, ChangeDesc, Facet,
        StateField, Extension} from "@codemirror/next/state"
import {EditorView, BlockInfo, Command, Decoration, DecorationSet, WidgetType, themeClass} from "@codemirror/next/view"
import {gutter, GutterMarker} from "@codemirror/next/gutter"
import {KeyBinding} from "@codemirror/next/keymap"

type Range = {from: number, to: number}

function mapRange(range: Range, mapping: ChangeDesc) {
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
      if (e.is(foldEffect) && !foldExists(folded, e.value.from, e.value.to))
        folded = folded.update({add: [FoldWidget.decoration.range(e.value.from, e.value.to)]})
      else if (e.is(unfoldEffect)) {
        folded = folded.update({filter: (from, to) => e.value.from != from || e.value.to != to,
                                filterFrom: e.value.from, filterTo: e.value.to})
      }
    }
    // Clear folded ranges that cover the selection head
    if (tr.selection) {
      let onSelection = false, {head} = tr.selection.primary
      folded.between(head, head, (a, b) => { if (a < head && b > head) onSelection = true })
      if (onSelection) folded = folded.update({
        filterFrom: head,
        filterTo: head,
        filter: (a, b) => b <= head || a >= head
      })
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

function foldExists(folded: DecorationSet, from: number, to: number) {
  let found = false
  folded.between(from, from, (a, b) => { if (a == from && b == to) found = true })
  return found
}

function getFoldable(state: EditorState, from: number, to: number) {
  return state.facet(EditorState.foldable).reduce<Range | null>((value, f) => value || f(state, from, to), null)
}

const tag = typeof Symbol == "undefined" ? "__codeFolding" : Symbol("codeFolding")

function maybeEnable(state: EditorState) {
  return state.field(foldState, false) ? undefined : {[tag]: codeFolding()}
}

/// Fold the lines that are selected, if possible.
export const foldCode: Command = view => {
  for (let line of selectedLines(view)) {
    let range = getFoldable(view.state, line.from, line.to)
    if (range) {
      view.dispatch(view.state.update({effects: foldEffect.of(range),
                                       replaceExtensions: maybeEnable(view.state)}))
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
  if (effects.length) view.dispatch(view.state.update({effects}))
  return effects.length > 0
}

/// Fold all top-level foldable ranges.
export const foldAll: Command = view => {
  let {state} = view, effects = []
  for (let pos = 0; pos < state.doc.length;) {
    let line = view.lineAt(pos, 0), range = getFoldable(state, line.from, line.to)
    if (range) effects.push(foldEffect.of(range))
    pos = (range ? view.lineAt(range.to) : line).to + 1
  }
  if (effects.length) view.dispatch(view.state.update({effects,
                                                       replaceExtensions: maybeEnable(view.state)}))
  return !!effects.length
}

/// Unfold all folded code.
export const unfoldAll: Command = view => {
  let field = view.state.field(foldState, false)
  if (!field || !field.size) return false
  let effects: StateEffect<any>[] = []
  field.between(0, view.state.doc.length, (from, to) => { effects.push(unfoldEffect.of({from, to})) })
  view.dispatch(view.state.update({effects}))
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
  /// Will be styled with the `foldPlaceholder` theme selector.
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

class FoldWidget extends WidgetType<null> {
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
      let line = view.lineAt(view.posAtDOM(event.target as HTMLElement))
      let folded = foldInside(view.state, line.from, line.to)
      if (folded) view.dispatch(view.state.update({effects: unfoldEffect.of(folded)}))
      event.preventDefault()
    }
    return element
  }

  static decoration = Decoration.replace({widget: new FoldWidget(null)})
}

/// Configuration used when defining a [fold
/// gutter](#fold.foldGutter).
export interface FoldGutterConfig {
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
/// fold status indicator before lines which can be clicked to fold or
/// unfold the line.
export function foldGutter(config: FoldGutterConfig = {}): Extension {
  let fullConfig = fillConfig(config, foldGutterDefaults)
  let canFold = new FoldMarker(fullConfig, true), canUnfold = new FoldMarker(fullConfig, false)
  return [
    gutter({
      style: "foldGutter",
      lineMarker(view, line) {
        // FIXME optimize this. At least don't run it for updates that
        // don't change anything relevant
        let folded = foldInside(view.state, line.from, line.to)
        if (folded) return canUnfold
        if (getFoldable(view.state, line.from, line.to)) return canFold
        return null
      },
      initialSpacer() {
        return new FoldMarker(fullConfig, false)
      },
      domEventHandlers: {
        click: (view, line) => {
          let folded = foldInside(view.state, line.from, line.to)
          if (folded) {
            view.dispatch(view.state.update({effects: unfoldEffect.of(folded)}))
            return true
          }
          let range = getFoldable(view.state, line.from, line.to)
          if (range) {
            view.dispatch(view.state.update({effects: foldEffect.of(range)}))
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
    backgroundColor: "#eee",
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
