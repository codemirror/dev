import {EditorView, ViewPlugin, ViewUpdate, Command, Decoration, DecorationSet, themeClass} from "../../view"
import {StateField, Facet, Annotation, EditorSelection, SelectionRange} from "../../state"
import {panels, PanelSpec, openPanel} from "../../panel"
import {Keymap, NormalizedKeymap, keymap} from "../../keymap"
import {Text, isWordChar} from "../../text"
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

const searchAnnotation = Annotation.define<{query?: Query, panel?: PanelSpec | null}>()

const searchState = StateField.define<SearchState>({
  create() {
    return new SearchState(new Query("", "", false), null)
  },
  update(search, tr) {
    let ann = tr.annotation(searchAnnotation)
    return ann ? new SearchState(ann.query || search.query, ann.panel === undefined ? search.panel : ann.panel) : search
  }
})

class SearchState {
  constructor(readonly query: Query, readonly panel: null | PanelSpec) {}
}

class SearchHighlighter extends ViewPlugin {
  decorations: DecorationSet

  constructor(readonly view: EditorView) {
    super()
    this.decorations = this.highlight(view.state.field(searchState).query)
  }

  update(update: ViewUpdate) {
    let state = update.state.field(searchState)
    if (state != update.prevState.field(searchState) || update.docChanged || update.selectionSet)
      this.decorations = this.highlight(state.query)
  }

  highlight(query: Query) {
    let state = this.view.state, viewport = this.view.viewport
    let deco = [], cursor = query.cursor(state.doc, Math.max(0, viewport.from - query.search.length),
                                         Math.min(viewport.to + query.search.length, state.doc.length))
    while (!cursor.next().done) {
      let {from, to} = cursor.value
      let selected = state.selection.ranges.some(r => r.from == from && r.to == to)
      deco.push(Decoration.mark(from, to, {class: themeClass(state, selected ? "searchMatch.selected" : "searchMatch")}))
    }
    return Decoration.set(deco)
  }
}

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
export const search = function(config: SearchConfig) {
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
    openPanel.derive([searchState], state => state.field(searchState).panel), // FIXME use field methods
    keymap(keys),
    panelKeymap.of(panelKeys),
    SearchHighlighter.extension,
    panels(),
    theme
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
  view.dispatch(view.state.t().setSelection(EditorSelection.single(next.from, next.to)).scrollIntoView())
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
  view.dispatch(state.t().setSelection(EditorSelection.single(range.from, range.to)).scrollIntoView())
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
  view.dispatch(view.state.t().setSelection(EditorSelection.create(ranges)))
  return true
}

/// Replace the current match of the search query.
export const replaceNext: Command = view => {
  let plugin = beforeCommand(view)
  if (typeof plugin == "boolean") return plugin

  let next = findNextMatch(view.state.doc, view.state.selection.primary.from, plugin.query)
  if (!next) return false
  let {from, to} = view.state.selection.primary, tr = view.state.t()
  if (next.from == from && next.to == to) {
    tr.replace(next.from, next.to, plugin.query.replace)
    next = findNextMatch(tr.doc, tr.changes.mapPos(next.to), plugin.query)
  }
  if (next) tr.setSelection(EditorSelection.single(next.from, next.to)).scrollIntoView()
  view.dispatch(tr)
  if (next) maybeAnnounceMatch(view)
  return true
}

/// Replace all instances of the search query with the given
/// replacement.
export const replaceAll: Command = view => {
  let plugin = beforeCommand(view)
  if (typeof plugin == "boolean") return plugin
  let cursor = plugin.query.cursor(view.state.doc), tr = view.state.t()
  while (!cursor.next().done) {
    let {from, to} = cursor.value
    tr.replace(tr.changes.mapPos(from, 1), tr.changes.mapPos(to, -1), plugin.query.replace)
  }
  if (!tr.docChanged) return false
  view.dispatch(tr)
  return true
}

/// Make sure the search panel is open and focused.
export const openSearchPanel: Command = view => {
  let state = view.state.field(searchState)!
  if (!state) return false
  if (!state.panel) {
    view.dispatch(view.state.t().annotate(searchAnnotation({
      panel: {
        create(view) {
          return buildPanel({
            view,
            keymap: view.state.facet(panelKeymap),
            query: state.query,
            updateQuery(query: Query) {
              if (!query.eq(state.query))
                view.dispatch(view.state.t().annotate(searchAnnotation({query})))
            }
          })
        },
        mount(_, dom) {
          ;(dom.querySelector("[name=search]") as HTMLInputElement).select()
        },
        pos: 80,
        style: "search"
      }
    })))
  }
  return true
}

/// Default search-related bindings.
///
///  * Mod-f: [`openSearchPanel`](#search.openSearchPanel)
///  * F3: [`findNext`](#search.findNext)
///  * Shift-F3: [`findPrevious`](#search.findPrevious)
export const defaultSearchKeymap = {
  "Mod-f": openSearchPanel,
  "F3": findNext,
  "Shift-F3": findPrevious
}

/// Close the search panel.
export const closeSearchPanel: Command = view => {
  let state = view.state.field(searchState)
  if (!state || !state.panel) return false
  let panel = view.dom.querySelector(".codemirror-panel-search")
  if (panel && panel.contains(view.root.activeElement)) view.focus()
  view.dispatch(view.state.t().annotate(searchAnnotation({panel: null})))
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
  function p(phrase: string) { return conf.view.phrase(phrase) }
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
  let panel = state.panel && view.dom.querySelector(".codemirror-panel-search")
  if (!panel || !panel.contains(view.root.activeElement)) return
  let live = panel.querySelector("div[aria-live]")!
  live.textContent = view.phrase("current match") + ". " + text
}

const theme = Facet.fallback(EditorView.theme({
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
}))
