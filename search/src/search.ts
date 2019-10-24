import {EditorState} from "../../state"
import {EditorView, ViewPlugin, ViewCommand, Decoration} from "../../view"
import {panels, openPanel} from "../../panel"

const searchPlugin = ViewPlugin.create(view => new SearchPlugin(view)).decorations(p => p.decorations)

class SearchPlugin {
  dialog: null | HTMLElement = null
  closeDialog: () => void = () => null
  searchQuery = ""
  replaceQuery = ""
  decorations = Decoration.none

  constructor(readonly view: EditorView) {}

  update() {}
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
      class: view.cssClass("panel search"),
      search: plugin.searchQuery,
      replace: plugin.replaceQuery,
      phrase(value: string) { return value }, // FIXME
      close() {
        if (plugin.dialog) {
          if (plugin.dialog.contains(view.root.activeElement)) view.focus()
          plugin.closeDialog()
          plugin.dialog = null
        }
      },
      updateSearch(value: string) { plugin.searchQuery = value },
      updateReplace(value: string) { plugin.replaceQuery = value },
      searchNext() {},
      replaceNext() {}
    })
    plugin.closeDialog = openPanel(view, {dom: plugin.dialog, pos: 80})
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

function buildDialog(conf: {class: string,
                            search: string,
                            replace: string,
                            phrase: (phrase: string) => string,
                            updateSearch: (search: string) => void,
                            updateReplace: (replace: string) => void,
                            searchNext: () => void,
                            replaceNext: () => void,
                            close: () => void}) {
  let onEnter = (f: () => void) => (event: KeyboardEvent) => {
    if (event.keyCode == 13) { event.preventDefault();  f() }
  }
  return elt("div", {
    className: conf.class,
    onkeydown(e: KeyboardEvent) {
      if (e.keyCode == 27) {
        e.preventDefault()
        conf.close()
      }
    }
  }, [
    elt("input", {
      value: conf.search,
      placeholder: conf.phrase("Find"),
      name: "search",
      onkeydown: onEnter(conf.searchNext),
      onchange(e: Event) {
        conf.updateSearch((e.target as HTMLInputElement).value)
      }
    }),
    " ",
    elt("button", {onclick: conf.searchNext}, [conf.phrase("Next")]),
    elt("br"),
    elt("input", {
      value: conf.replace,
      placeholder: conf.phrase("Replace"),
      name: "replace",
      onkeydown: onEnter(conf.replaceNext)
    }),      
    " ",
    elt("button", {onclick: conf.replaceNext}, [conf.phrase("Replace")]),
    elt("button", {className: "close", onclick: conf.close}, ["×"]) // FIXME accessible, styling
  ])
}

const theme = {
  search: { // FIXME panel.search
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
  }
}
