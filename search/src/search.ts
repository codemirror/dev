import {EditorView, ViewPlugin, ViewUpdate, Command, Decoration, DecorationSet, themeClass} from "@codemirror/next/view"
import {StateField, StateEffect, EditorSelection, SelectionRange, StateCommand} from "@codemirror/next/state"
import {panels, Panel, showPanel, getPanel} from "@codemirror/next/panel"
import {runScopeHandlers, KeyBinding} from "@codemirror/next/keymap"
import {Text} from "@codemirror/next/text"
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

function searchCommand(f: (view: EditorView, state: SearchState) => boolean): Command {
  return view => {
    let state = view.state.field(searchState, false)
    return state && state.query.valid ? f(view, state) : openSearchPanel(view)
  }
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
export const findNext = searchCommand((view, state) => {
  let {from, to} = view.state.selection.primary
  let next = findNextMatch(view.state.doc, view.state.selection.primary.from + 1, state.query)
  if (!next || next.from == from && next.to == to) return false
  view.dispatch(view.state.update({selection: {anchor: next.from, head: next.to}, scrollIntoView: true}))
  maybeAnnounceMatch(view)
  return true
})

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
export const findPrevious = searchCommand((view, {query}) => {
  let {state} = view
  let range = findPrevInRange(query, state.doc, 0, state.selection.primary.to - 1) ||
    findPrevInRange(query, state.doc, state.selection.primary.from + 1, state.doc.length)
  if (!range) return false
  view.dispatch(state.update({selection: {anchor: range.from, head: range.to}, scrollIntoView: true}))
  maybeAnnounceMatch(view)
  return true
})

/// Select all instances of the search query.
export const selectMatches = searchCommand((view, {query}) => {
  let cursor = query.cursor(view.state.doc), ranges: SelectionRange[] = []
  while (!cursor.next().done) ranges.push(EditorSelection.range(cursor.value.from, cursor.value.to))
  if (!ranges.length) return false
  view.dispatch(view.state.update({selection: EditorSelection.create(ranges)}))
  return true
})

/// Select all instances of the currently selected text.
export const selectSelectionMatches: StateCommand = ({state, dispatch}) => {
  let sel = state.selection
  if (sel.ranges.length > 1 || sel.primary.empty) return false
  let {from, to} = sel.primary
  let ranges = [], primary = 0
  for (let cur = new SearchCursor(state.doc, state.sliceDoc(from, to)); !cur.next().done;) {
    if (ranges.length > 1000) return false
    if (cur.value.from == from) primary = ranges.length
    ranges.push(EditorSelection.range(cur.value.from, cur.value.to))
  }
  dispatch(state.update({selection: new EditorSelection(ranges, primary)}))
  return true
}

/// Replace the current match of the search query.
export const replaceNext = searchCommand((view, {query}) => {
  let {state} = view, next = findNextMatch(state.doc, state.selection.primary.from, query)
  if (!next) return false
  let {from, to} = state.selection.primary, changes = [], selection: {anchor: number, head: number} | undefined
  if (next.from == from && next.to == to) {
    changes.push({from: next.from, to: next.to, insert: query.replace})
    next = findNextMatch(state.doc, next.to, query)
  }
  if (next) {
    let off = changes.length == 0 || changes[0].from >= next.to ? 0 : next.to - next.from - query.replace.length
    selection = {anchor: next.from - off, head: next.to - off}
  }
  view.dispatch(state.update({changes, selection, scrollIntoView: !!selection}))
  if (next) maybeAnnounceMatch(view)
  return true
})

/// Replace all instances of the search query with the given
/// replacement.
export const replaceAll = searchCommand((view, {query}) => {
  let cursor = query.cursor(view.state.doc), changes = []
  while (!cursor.next().done) {
    let {from, to} = cursor.value
    changes.push({from, to, insert: query.replace})
  }
  if (!changes.length) return false
  view.dispatch(view.state.update({changes}))
  return true
})

function createSearchPanel(view: EditorView) {
  let {query} = view.state.field(searchState)
  return {
    dom: buildPanel({
      view,
      query,
      updateQuery(q: Query) {
        if (!query.eq(q)) {
          query = q
          view.dispatch(view.state.update({effects: setQuery.of(query)}))
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

const tag = typeof Symbol == "function" ? Symbol("search") : "__search-tag"

/// Make sure the search panel is open and focused.
export const openSearchPanel: Command = view => {
  let state = view.state.field(searchState, false)
  if (state && state.panel.length) return false
  view.dispatch(view.state.update({effects: togglePanel.of(true),
                                   replaceExtensions: state ? undefined : {[tag]: searchExtensions}}))
  return true
}

/// Default search-related key bindings.
///
///  * Mod-f: [`openSearchPanel`](#search.openSearchPanel)
///  * F3, Mod-g: [`findNext`](#search.findNext)
///  * Shift-F3, Shift-Mod-g: [`findPrevious`](#search.findPrevious)
export const searchKeymap: readonly KeyBinding[] = [
  {key: "Mod-f", run: openSearchPanel, scope: "editor search-panel"},
  {key: "F3", run: findNext, shift: findPrevious, scope: "editor search-panel"},
  {key: "Mod-g", run: findNext, shift: findPrevious, scope: "editor search-panel"},
  {key: "Mod-Shift-l", run: selectSelectionMatches}
]

/// Close the search panel.
export const closeSearchPanel: Command = view => {
  let state = view.state.field(searchState, false)
  if (!state || !state.panel.length) return false
  let panel = getPanel(view, createSearchPanel)
  if (panel && panel.dom.contains(view.root.activeElement)) view.focus()
  view.dispatch(view.state.update({effects: togglePanel.of(false)}))
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
  view: EditorView,
  query: Query,
  updateQuery: (query: Query) => void
}) {
  function p(phrase: string) { return conf.view.state.phrase(phrase) }
  let searchField = elt("input", {
    value: conf.query.search,
    placeholder: p("Find"),
    "aria-label": p("Find"),
    class: themeClass("textfield"),
    name: "search",
    onchange: update,
    onkeyup: update
  }) as HTMLInputElement
  let replaceField = elt("input", {
    value: conf.query.replace,
    placeholder: p("Replace"),
    "aria-label": p("Replace"),
    class: themeClass("textfield"),
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
    if (runScopeHandlers(conf.view, e, "search-panel")) {
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
  function button(name: string, onclick: () => void, content: (Node | string)[]) {
    return elt("button", {class: themeClass("button"), name, onclick}, content)
  }
  let panel = elt("div", {onkeydown: keydown}, [
    searchField,
    button("next", () => findNext(conf.view), [p("next")]),
    button("prev", () => findPrevious(conf.view), [p("previous")]),
    button("select", () => selectMatches(conf.view), [p("all")]),
    elt("label", null, [caseField, "match case"]),
    elt("br"),
    replaceField,
    button("replace", () => replaceNext(conf.view), [p("replace")]),
    button("replaceAll", () => replaceAll(conf.view), [p("replace all")]),
    elt("button", {name: "close", onclick: () => closeSearchPanel(conf.view), "aria-label": p("close")}, ["×"]),
    elt("div", {style: "position: absolute; top: -10000px", "aria-live": "polite"})
  ])
  return panel
}

const AnnounceMargin = 30

const Break = /[\s\.,:;?!]/

// FIXME this is a kludge
function maybeAnnounceMatch(view: EditorView) {
  let {from, to} = view.state.selection.primary
  let lineStart = view.state.doc.lineAt(from).start, lineEnd = view.state.doc.lineAt(to).end
  let start = Math.max(lineStart, from - AnnounceMargin), end = Math.min(lineEnd, to + AnnounceMargin)
  let text = view.state.sliceDoc(start, end)
  if (start != lineStart) {
    for (let i = 0; i < AnnounceMargin; i++) if (!Break.test(text[i + 1]) && Break.test(text[i])) {
      text = text.slice(i)
      break
    }
  }
  if (end != lineEnd) {
    for (let i = text.length - 1; i > text.length - AnnounceMargin; i--) if (!Break.test(text[i - 1]) && Break.test(text[i])) {
      text = text.slice(0, i)
      break
    }
  }

  let panel = getPanel(view, createSearchPanel)
  if (!panel || !panel.dom.contains(view.root.activeElement)) return
  let live = panel.dom.querySelector("div[aria-live]")!
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
      backgroundColor: "inherit",
      border: "none",
      font: "inherit",
      padding: 0,
      margin: 0
    },
    "& input, & button": {
      margin: ".2em .5em .2em 0"
    },
    "& label": {
      fontSize: "80%"
    }
  },

  "searchMatch@light": { backgroundColor: "#ffa" },
  "searchMatch@dark": { backgroundColor: "#088" },

  "searchMatch.selected@light": { backgroundColor: "#fca" },
  "searchMatch.selected@dark": { backgroundColor: "#808" }
})

const searchExtensions = [
  searchState,
  searchHighlighter,
  panels(),
  baseTheme
]
