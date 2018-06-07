import {EditorState, Transaction} from "../../state/src/state"
import {DocViewDesc, PluginDeco} from "./viewdesc"
import {DOMObserver} from "./domobserver"
import {InputState, attachEventHandlers} from "./input"
import {SelectionReader, selectionToDOM} from "./selection"
import {DecorationSet} from "./decoration"

export class EditorView {
  private _state: EditorState;
  get state(): EditorState { return this._state }

  // FIXME get rid of bare props entirely, and have people provide a
  // plugin if they need props?
  readonly props: EditorProps;

  private _root: Document | null = null;

  public dispatch: (tr: Transaction) => void;

  public dom: Element;
  public contentDOM: Element;

  public inputState: InputState = new InputState;
  // (Many of these things should be module-private)

  public docView: DocViewDesc;
  public domObserver: DOMObserver;
  public selectionReader: SelectionReader;

  constructor(state: EditorState, props: EditorProps = {}, dispatch: ((tr: Transaction) => void) | undefined = undefined) {
    this._state = state
    this.props = props
    this.dispatch = dispatch || (tr => this.setState(tr.apply()))

    this.contentDOM = document.createElement("pre")
    this.contentDOM.className = "CM-content"
    this.contentDOM.setAttribute("contenteditable", "true")
    this.contentDOM.setAttribute("spellcheck", "false")

    this.dom = document.createElement("div")
    this.dom.className = "CM"
    this.dom.appendChild(this.contentDOM)

    this.domObserver = new DOMObserver(this)
    attachEventHandlers(this)
    this.selectionReader = new SelectionReader(this)

    const registeredEvents = []
    const handleDOMEvents = this.someProp("handleDOMEvents")
    for (const key in handleDOMEvents) {
      if (Object.prototype.hasOwnProperty.call(handleDOMEvents, key) && registeredEvents.indexOf(key) == -1) {
        this.contentDOM.addEventListener(key, event => {
          const res = handleDOMEvents[event.type](this, event)
          if (res) event.preventDefault()
          return res
        })
        registeredEvents.push(key)
      }
    }

    this.docView = new DocViewDesc(state.doc, this.getDecorations(), this.contentDOM)
    this.domObserver.start()
  }

  setState(state: EditorState) {
    let prev = this.state
    this._state = state
    let decorations = this.getDecorations()
    let updateDOM = state.doc != prev.doc || this.docView.dirty || !sameDecorations(decorations, this.docView.decorations)
    let updateSel = updateDOM || !prev.selection.eq(state.selection)
    if (updateSel) {
      this.selectionReader.ignoreUpdates = true
      if (updateDOM) {
        this.domObserver.stop()
        this.docView.update(state.doc, decorations)
        this.docView.sync()
        this.domObserver.start()
        this.selectionReader.clearDOMState()
      }
      selectionToDOM(this)
      this.selectionReader.ignoreUpdates = false
    }
  }

  private getDecorations(): PluginDeco[] {
    let result: PluginDeco[] = [], plugins = this.state.plugins
    if (this.props.decorations) {
      let decorations = this.props.decorations(this.state)
      if (decorations.size) result.push({plugin: null, decorations})
    }
    for (let i = 0; i < plugins.length; i++) {
      let prop = plugins[i].props.decorations
      if (!prop) continue
      let decorations = prop(this.state)
      if (decorations.size) result.push({plugin: plugins[i], decorations})
    }
    return result
  }

  // FIXME this is very awkward to type. Change or embrace the any?
  someProp(propName: string, f: ((value: any) => any) | undefined = undefined): any {
    let prop = (this.props as any)[propName], value
    if (prop != null && (value = f ? f(prop) : prop)) return value
    let plugins = this.state.plugins
    for (let i = 0; i < plugins.length; i++) {
      let prop = plugins[i].props[propName]
      if (prop != null && (value = f ? f(prop) : prop)) return value
    }
    return null
  }

  // FIXME can also return a DocumentFragment, but TypeScript doesn't
  // believe that has getSelection etc methods
  get root(): Document {
    let cached = this._root
    if (cached == null) {
      for (let search: any = this.dom.parentNode; search; search = search.parentNode) {
        if (search.nodeType == 9 || (search.nodeType == 11 && search.host))
          return this._root = search
      }
    }
    return document
  }

  hasFocus(): boolean {
    return this.root.activeElement == this.contentDOM
  }

  focus() {
    selectionToDOM(this, true)
  }

  destroy() {
    this.domObserver.stop()
    this.selectionReader.destroy()
    this.dom.remove()
  }
}

interface EditorProps {
  readonly handleDOMEvents?: {[key: string]: (view: EditorView, event: Event) => boolean};
  readonly decorations?: (state: EditorState) => DecorationSet;
}

function sameDecorations(a: PluginDeco[], b: PluginDeco[]) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].decorations != b[i].decorations) return false
  return true
}
