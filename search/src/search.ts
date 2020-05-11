import {EditorView, ViewPlugin, ViewUpdate, Command, Decoration, DecorationSet, themeClass} from "@codemirror/next/view"
import {StateField, Facet, StateEffect, EditorSelection, SelectionRange, Extension} from "@codemirror/next/state"
import {panels, Panel, showPanel} from "@codemirror/next/panel"
import {Keymap, NormalizedKeymap, keymap} from "@codemirror/next/keymap"
import {Text, isWordChar} from "@codemirror/next/text"
import {RangeSetBuilder} from "@codemirror/next/rangeset"
import {SearchCursor} from "./cursor"
export {SearchCursor}

class Query {
  constructor(readonly search: string,
              readonly replace: string,
              readonly caseInsensitive: boolean) {}

  eq(other: Query) {
    return this.search == other.search && this.replace == other.replace && this.caseInsensitive == other.caseInsensitive
  }

  cursor(doc: Text, from = 0, to = doc.length) {
    return new SearchCursor(doc, this.search, from, to, this.caseInsensitive ? x => x.toLowerCase() : undefined)
  }

  get valid() { return !!this.search }
}

const setQuery = StateEffect.define<Query>()

const togglePanel = StateEffect.define<boolean>()

const searchState: StateField<SearchState> = StateField.define<SearchState>({
  create() {
    return new SearchState(new Query("", "", false), [])
  },
  update(value, tr) {
    for (let effect of tr.effects) {
      if (effect.is(setQuery)) value = new SearchState(effect.value, value.panel)
      else if (effect.is(togglePanel)) value = new SearchState(value.query, effect.value ? [createSearchPanel] : [])
    }
    return value
  },
  provide: [showPanel.nFrom(s => s.panel)]
})

class SearchState {
  constructor(readonly query: Query, readonly panel: readonly ((view: EditorView) => Panel)[]) {}
}

const matchMark = Decoration.mark({class: themeClass("searchMatch")}),
      selectedMatchMark = Decoration.mark({class: themeClass("searchMatch.selected")})

const searchHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(readonly view: EditorView) {
    this.decorations = this.highlight(view.state.field(searchState))
  }

  update(update: ViewUpdate) {
    let state = update.state.field(searchState)
    if (state != update.prevState.field(searchState) || update.docChanged || update.selectionSet)
      this.decorations = this.highlight(state)
  }

  highlight({query, panel}: SearchState) {
    if (!panel.length || !query.valid) return Decoration.none
    let state = this.view.state, viewport = this.view.viewport
    let cursor = query.cursor(state.doc, Math.max(0, viewport.from - query.search.length),
                              Math.min(viewport.to + query.search.length, state.doc.length))
    let builder = new RangeSetBuilder<Decoration>()
    while (!cursor.next().done) {
      let {from, to} = cursor.value
      let selected = state.selection.ranges.some(r => r.from == from && r.to == to)
      builder.add(from, to, selected ? selectedMatchMark : matchMark)
    }
    return builder.finish()
  }
}).decorations()

/// The configuration options passed to [`search`](#search.search).
export interface SearchConfig {
  /// A keymap with search-related bindings that should be enabled in
  /// the editor. You can pass
  /// [`defaultSearchKeymap`](#search.defaultSearchKeymap) here.
  ///
  /// Configuring bindings like this differs from just passing the
  /// keymap as a separate extension in that the bindings in this
  /// keymap are also available when the search panel is focused.
  keymap?: Keymap

  /// Additional key bindings to enable only in the search panel.
  panelKeymap?: Keymap
}

const panelKeymap = Facet.define<Keymap, NormalizedKeymap<Command>>({
  combine(keymaps) {
    let result = Object.create(null)
    for (let map of keymaps) for (let prop of Object.keys(map)) result[prop] = map[prop]
    return new NormalizedKeymap(result)
  }
})

/// Create an extension that enables search/replace functionality.
/// This needs to be enabled for any of the search-related commands to
/// work.
export const search = function(config: SearchConfig): Extension {
  // FIXME make multiple instances of this combine, somehow
  let keys = Object.create(null), panelKeys = Object.create(null)
  if (config.keymap) for (let key of Object.keys(config.keymap)) {
    panelKeys[key] = keys[key] = config.keymap[key]
  }
  if (config.panelKeymap) for (let key of Object.keys(config.panelKeymap)) {
    panelKeys[key] = config.panelKeymap[key]
  }
  return [
    searchState,
    keymap(keys),
    panelKeymap.of(panelKeys),
    searchHighlighter,
    panels(),
    baseTheme
  ]
}

function beforeCommand(view: EditorView): boolean | SearchState {
  let state = view.state.field(searchState)
  if (!state) return false
  if (!state.query.valid) {
    openSearchPanel(view)
    return true
  }
  return state
}

function findNextMatch(doc: Text, from: number, query: Query) {
  let cursor = query.cursor(doc, from).next()
  if (cursor.done) {
    cursor = query.cursor(doc, 0, from + query.search.length - 1).next()
    if (cursor.done) return null
  }
  return cursor.value
}

/// Open the search panel if it isn't already open, and move the
/// selection to the first match after the current primary selection.
/// Will wrap around to the start of the document when it reaches the
/// end.
export const findNext: Command = view => {
  let state = beforeCommand(view)
  if (typeof state == "boolean") return state
  let {from, to} = view.state.selection.primary
  let next = findNextMatch(view.state.doc, view.state.selection.primary.from + 1, state.query)
  if (!next || next.from == from && next.to == to) return false
  view.dispatch(view.state.tr({selection: {anchor: next.from, head: next.to}, scrollIntoView: true}))
  maybeAnnounceMatch(view)
  return true
}

const FindPrevChunkSize = 10000

// Searching in reverse is, rather than implementing inverted search
// cursor, done by scanning chunk after chunk forward.
function findPrevInRange(query: Query, doc: Text, from: number, to: number) {
  for (let pos = to;;) {
    let start = Math.max(from, pos - FindPrevChunkSize - query.search.length)
    let cursor = query.cursor(doc, start, pos), range: {from: number, to: number} | null = null
    while (!cursor.next().done) range = cursor.value
    if (range) return range
    if (start == from) return null
    pos -= FindPrevChunkSize
  }
}

/// Move the selection to the previous instance of the search query,
/// before the current primary selection. Will wrap past the start
/// of the document to start searching at the end again.
export const findPrevious: Command = view => {
  let plugin = beforeCommand(view)
  if (typeof plugin == "boolean") return plugin
  let {state} = view, {query} = plugin
  let range = findPrevInRange(query, state.doc, 0, state.selection.primary.to - 1) ||
    findPrevInRange(query, state.doc, state.selection.primary.from + 1, state.doc.length)
  if (!range) return false
  view.dispatch(state.tr({selection: {anchor: range.from, head: range.to}, scrollIntoView: true}))
  maybeAnnounceMatch(view)
  return true
}

/// Select all instances of the search query.
export const selectMatches: Command = view => {
  let plugin = beforeCommand(view)
  if (typeof plugin == "boolean") return plugin
  let cursor = plugin.query.cursor(view.state.doc), ranges: SelectionRange[] = []
  while (!cursor.next().done) ranges.push(new SelectionRange(cursor.value.from, cursor.value.to))
  if (!ranges.length) return false
  view.dispatch(view.state.tr({selection: EditorSelection.create(ranges)}))
  return true
}

/// Replace the current match of the search query.
export const replaceNext: Command = view => {
  let plugin = beforeCommand(view)
  if (typeof plugin == "boolean") return plugin

  let {state} = view, next = findNextMatch(state.doc, state.selection.primary.from, plugin.query)
  if (!next) return false
  let {from, to} = state.selection.primary, changes = [], selection: {anchor: number, head: number} | undefined
  if (next.from == from && next.to == to) {
    changes.push({from: next.from, to: next.to, insert: plugin.query.replace})
    next = findNextMatch(state.doc, next.to, plugin.query)
  }
  if (next) {
    let off = changes.length == 0 || changes[0].from >= next.to ? 0 : next.to - next.from - plugin.query.replace.length
    selection = {anchor: next.from - off, head: next.to - off}
  }
  view.dispatch(state.tr({changes, selection, scrollIntoView: !!selection}))
  if (next) maybeAnnounceMatch(view)
  return true
}

/// Replace all instances of the search query with the given
/// replacement.
export const replaceAll: Command = view => {
  let plugin = beforeCommand(view)
  if (typeof plugin == "boolean") return plugin
  let cursor = plugin.query.cursor(view.state.doc), changes = []
  while (!cursor.next().done) {
    let {from, to} = cursor.value
    changes.push({from, to, insert: plugin.query.replace})
  }
  if (changes.length) return false
  view.dispatch(view.state.tr({changes}))
  return true
}

function createSearchPanel(view: EditorView) {
  let {query} = view.state.field(searchState)
  return {
    dom: buildPanel({
      view,
      keymap: view.state.facet(panelKeymap),
      query,
      updateQuery(q: Query) {
        if (!query.eq(q)) {
          query = q
          view.dispatch(view.state.tr({effects: setQuery.of(query)}))
        }
      }
    }),
    mount() {
      ;(this.dom.querySelector("[name=search]") as HTMLInputElement).select()
    },
    pos: 80,
    style: "search"
  }
}

/// Make sure the search panel is open and focused.
export const openSearchPanel: Command = view => {
  let state = view.state.field(searchState)!
  if (!state) return false
  if (!state.panel.length)
    view.dispatch(view.state.tr({effects: togglePanel.of(true)}))
  return true
}

/// Default search-related bindings.
///
///  * Mod-f: [`openSearchPanel`](#search.openSearchPanel)
///  * F3, Mod-g: [`findNext`](#search.findNext)
///  * Shift-F3, Shift-Mod-g: [`findPrevious`](#search.findPrevious)
export const defaultSearchKeymap = {
  "Mod-f": openSearchPanel,
  "F3": findNext,
  "Mod-g": findNext,
  "Shift-F3": findPrevious,
  "Shift-Mod-g": findPrevious
}

/// Close the search panel.
export const closeSearchPanel: Command = view => {
  let state = view.state.field(searchState)
  if (!state || !state.panel.length) return false
  let panel = view.dom.querySelector(".cm-panel-search")
  if (panel && panel.contains(view.root.activeElement)) view.focus()
  view.dispatch(view.state.tr({effects: togglePanel.of(false)}))
  return true
}

function elt(name: string, props: null | {[prop: string]: any} = null, children: (Node | string)[] = []) {
  let e = document.createElement(name)
  if (props) for (let prop in props) {
    let value = props[prop]
    if (typeof value == "string") e.setAttribute(prop, value)
    else (e as any)[prop] = value
  }
  for (let child of children)
    e.appendChild(typeof child == "string" ? document.createTextNode(child) : child)
  return e
}

// FIXME sync when search state changes independently
function buildPanel(conf: {
  keymap: NormalizedKeymap<Command>,
  view: EditorView,
  query: Query,
  updateQuery: (query: Query) => void
}) {
  function p(phrase: string) { return conf.view.state.phrase(phrase) }
  let searchField = elt("input", {
    value: conf.query.search,
    placeholder: p("Find"),
    "aria-label": p("Find"),
    name: "search",
    onchange: update,
    onkeyup: update
  }) as HTMLInputElement
  let replaceField = elt("input", {
    value: conf.query.replace,
    placeholder: p("Replace"),
    "aria-label": p("Replace"),
    name: "replace",
    onchange: update,
    onkeyup: update
  }) as HTMLInputElement
  let caseField = elt("input", {
    type: "checkbox",
    name: "case",
    checked: !conf.query.caseInsensitive,
    onchange: update
  }) as HTMLInputElement
  function update() {
    conf.updateQuery(new Query(searchField.value, replaceField.value, !caseField.checked))
  }
  function keydown(e: KeyboardEvent) {
    let mapped = conf.keymap.get(e)
    if (mapped && mapped(conf.view)) {
      e.preventDefault()
    } else if (e.keyCode == 27) {
      e.preventDefault()
      closeSearchPanel(conf.view)
    } else if (e.keyCode == 13 && e.target == searchField) {
      e.preventDefault()
      ;(e.shiftKey ? findPrevious : findNext)(conf.view)
    } else if (e.keyCode == 13 && e.target == replaceField) {
      e.preventDefault()
      replaceNext(conf.view)
    }
  }
  let panel = elt("div", {onkeydown: keydown}, [
    searchField,
    elt("button", {name: "next", onclick: () => findNext(conf.view)}, [p("next")]),
    elt("button", {name: "prev", onclick: () => findPrevious(conf.view)}, [p("previous")]),
    elt("button", {name: "select", onclick: () => selectMatches(conf.view)}, [p("all")]),
    elt("label", null, [caseField, "match case"]),
    elt("br"),
    replaceField,
    elt("button", {name: "replace", onclick: () => replaceNext(conf.view)}, [p("replace")]),
    elt("button", {name: "replaceAll", onclick: () => replaceAll(conf.view)}, [p("replace all")]),
    elt("button", {name: "close", onclick: () => closeSearchPanel(conf.view), "aria-label": p("close")}, ["×"]),
    elt("div", {style: "position: absolute; top: -10000px", "aria-live": "polite"})
  ])
  return panel
}

const AnnounceMargin = 30

// FIXME this is a kludge
function maybeAnnounceMatch(view: EditorView) {
  let {doc} = view.state, {from, to} = view.state.selection.primary
  let lineStart = doc.lineAt(from).start, lineEnd = doc.lineAt(to).end
  let start = Math.max(lineStart, from - AnnounceMargin), end = Math.min(lineEnd, to + AnnounceMargin)
  let text = doc.slice(start, end)
  if (start != lineStart) {
    for (let i = 0; i < AnnounceMargin; i++) if (isWordChar(text[i + 1]) && !isWordChar(text[i])) {
      text = text.slice(i)
      break
    }
  }
  if (end != lineEnd) {
    for (let i = text.length - 1; i > text.length - AnnounceMargin; i--) if (isWordChar(text[i - 1]) && !isWordChar(text[i])) {
      text = text.slice(0, i)
      break
    }
  }

  let state = view.state.field(searchState)
  let panel = state.panel.length && view.dom.querySelector(".cm-panel-search")
  if (!panel || !panel.contains(view.root.activeElement)) return
  let live = panel.querySelector("div[aria-live]")!
  live.textContent = view.state.phrase("current match") + ". " + text
}

const baseTheme = EditorView.baseTheme({
  "panel.search": {
    padding: "2px 6px 4px",
    position: "relative",
    "& [name=close]": {
      position: "absolute",
      top: "0",
      right: "4px",
      background: "inherit",
      border: "none",
      font: "inherit",
      padding: 0,
      margin: 0
    },
    "& input, & button": {
      verticalAlign: "middle",
      marginRight: ".5em"
    },
    "& label": {
      fontSize: "80%"
    }
  },

  searchMatch: {
    background: "#ffa"
  },

  "searchMatch.selected": {
    background: "#fca"
  }
})
