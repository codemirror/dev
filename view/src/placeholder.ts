import {Extension} from "@codemirror/next/state"
import {ViewPlugin} from "./extension"
import {Decoration, DecorationSet, WidgetType} from "./decoration"
import {EditorView} from "./editorview"
import {themeClass} from "./theme"

class Placeholder extends WidgetType {
  constructor(readonly content: string | HTMLElement) { super() }

  toDOM() {
    let wrap = document.createElement("span")
    wrap.className = themeClass("placeholder")
    wrap.style.pointerEvents = "none"
    wrap.appendChild(typeof this.content == "string" ? document.createTextNode(this.content) : this.content)
    if (typeof this.content == "string")
      wrap.setAttribute("aria-label", "placeholder " + this.content)
    else
      wrap.setAttribute("aria-hidden", "true")
    return wrap
  }

  ignoreEvent() { return false }
}

export function placeholder(content: string | HTMLElement): Extension {
  return ViewPlugin.fromClass(class {
    placeholder: DecorationSet

    constructor(readonly view: EditorView) {
      this.placeholder = Decoration.set([Decoration.widget({widget: new Placeholder(content), side: 1}).range(0)])
    }

    get decorations() { return this.view.state.doc.length ? Decoration.none : this.placeholder }
  } as any, {decorations: v => (v as any).decorations})
}
