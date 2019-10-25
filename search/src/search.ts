import {EditorView, ViewPlugin, ViewCommand, ViewUpdate, Decoration} from "../../view"
import {EditorState, Slot} from "../../state"
import {panels, openPanel} from "../../panel"

const searchPlugin = ViewPlugin.create(view => new SearchPlugin(view)).decorations(p => p.decorations)

const querySlot = Slot.define<{search: string, replace: string}>()

class SearchPlugin {
  dialog: null | HTMLElement = null
  closeDialog: () => void = () => null
  query = {search: "", replace: ""}
  decorations = Decoration.none

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    let query = update.getMeta(querySlot), changed = query && query.search != this.query.search
    if (query) this.query = query
    if (!this.query.search || !this.dialog)
      this.decorations = Decoration.none
    else if (changed || update.docChanged || update.transactions.some(tr => tr.selectionSet))
      this.decorations = this.highlight(this.query.search, update.state, update.viewport)
  }

  highlight(query: string, state: EditorState, viewport: {from: number, to: number}) {
    let deco = []
    for (let pos = viewport.from, cursor = state.doc.iterRange(pos, viewport.to); !(cursor.next().done);) {
      let found = cursor.value.indexOf(query) // FIXME matches on chunk boundaries
      if (found >= 0) {
        let from = found + pos, to = from + query.length
        let selected = state.selection.ranges.some(r => r.from == from && r.to == to)
        deco.push(Decoration.mark(from, to, {class: this.view.cssClass(selected ? "searchMatch.selected" : "searchMatch")}))
      }
      pos += cursor.value.length
    }
    return Decoration.set(deco)
  }
}

export const search = EditorView.extend.unique<null>(() => [
  searchPlugin.extension,
  panels(),
  EditorView.extend.fallback(EditorView.theme(theme))
], null)

export const openSearchPanel: ViewCommand = view => {
  let plugin = view.plugin(searchPlugin)!
  if (!plugin) throw new Error("Search plugin not enabled")
  if (!plugin.dialog) {
    plugin.dialog = buildDialog({
      query: plugin.query,
      phrase(value: string) { return value }, // FIXME
      close() {
        if (plugin.dialog) {
          if (plugin.dialog.contains(view.root.activeElement)) view.focus()
          plugin.closeDialog()
          plugin.dialog = null
        }
      },
      updateSearch(value: string) {
        if (value != plugin.query.search)
          view.dispatch(view.state.t().addMeta(querySlot({search: value, replace: plugin.query.replace})))
      },
      updateReplace(value: string) {
        if (value != plugin.query.replace)
          view.dispatch(view.state.t().addMeta(querySlot({search: plugin.query.search, replace: value})))
      },
      searchNext() {},
      replaceNext() {}
    })
    plugin.closeDialog = openPanel(view, {dom: plugin.dialog, pos: 80, style: "search"})
  }
  ;(plugin.dialog.querySelector("[name=search]") as HTMLInputElement).select()
  return true
}

function elt(name: string, props: null | {[prop: string]: any} = null, children: (Node | string)[] = []) {
  let e = document.createElement(name)
  if (props) for (let prop in props) (e as any)[prop] = props[prop]
  for (let child of children)
    e.appendChild(typeof child == "string" ? document.createTextNode(child) : child)
  return e
}

function buildDialog(conf: {query: {search: string, replace: string},
                            phrase: (phrase: string) => string,
                            updateSearch: (search: string) => void,
                            updateReplace: (replace: string) => void,
                            searchNext: () => void,
                            replaceNext: () => void,
                            close: () => void}) {
  let onEnter = (f: () => void) => (event: KeyboardEvent) => {
    if (event.keyCode == 13) { event.preventDefault();  f() }
  }
  let update = (f: (value: string) => void) => (event: Event) => f((event.target as HTMLInputElement).value)
  return elt("div", {
    onkeydown(e: KeyboardEvent) {
      if (e.keyCode == 27) {
        e.preventDefault()
        conf.close()
      }
    }
  }, [
    elt("input", {
      value: conf.query.search,
      placeholder: conf.phrase("Find"),
      name: "search",
      onkeydown: onEnter(conf.searchNext),
      onchange: update(conf.updateSearch),
      onkeyup: update(conf.updateSearch)
    }),
    " ",
    elt("button", {onclick: conf.searchNext}, [conf.phrase("Next")]),
    elt("br"),
    elt("input", {
      value: conf.query.replace,
      placeholder: conf.phrase("Replace"),
      name: "replace",
      onkeydown: onEnter(conf.replaceNext),
      onchange: update(conf.updateReplace),
      onkeyup: update(conf.updateReplace)
    }),      
    " ",
    elt("button", {onclick: conf.replaceNext}, [conf.phrase("Replace")]),
    elt("button", {className: "close", onclick: conf.close}, ["×"]) // FIXME accessible, styling
  ])
}

const theme = {
  "panel.search": {
    padding: "2px 6px 4px",
    position: "relative",
    "& .close": {
      position: "absolute",
      top: "2px",
      right: "2px",
      background: "inherit",
      border: "none",
      font: "inherit",
      padding: 0
    },
    "& input, & button": {
      verticalAlign: "middle"
    }
  },

  searchMatch: {
    background: "#ffa"
  },

  "searchMatch.selected": {
    background: "#fca"
  }
}
