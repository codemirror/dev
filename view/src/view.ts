import {EditorState, Transaction, Selection, MetaSlot} from "../../state/src/state"
import {DocViewDesc} from "./viewdesc"
import {InputState, attachEventHandlers} from "./input"
import {getRoot, selectionCollapsed} from "./dom"
import {DecorationSet} from "./decoration"
import {applyDOMChange} from "./domchange"

export class EditorView {
  private _state: EditorState;
  get state(): EditorState { return this._state }

  public dispatch: (tr: Transaction) => void;

  public dom: HTMLElement;
  public contentDOM: HTMLElement;

  /** @internal */
  public inputState: InputState = new InputState;

  /** @internal */
  public docView: DocViewDesc;

  private layoutCheckScheduled: number | null = null;

  constructor(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined = undefined) {
    this._state = state
    this.dispatch = dispatch || (tr => this.setState(tr.apply()))

    this.contentDOM = document.createElement("pre")
    this.contentDOM.className = "CM-content"
    this.contentDOM.setAttribute("contenteditable", "true")
    this.contentDOM.setAttribute("spellcheck", "false")

    this.dom = document.createElement("div")
    this.dom.className = "CM"
    this.dom.appendChild(this.contentDOM)

    attachEventHandlers(this)

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

    this.docView = new DocViewDesc(this.contentDOM, (start, end) => applyDOMChange(this, start, end),
                                   () => applySelectionChange(this))
    this.docView.update(state)
  }

  setState(state: EditorState) {
    this._state = state

    // FIXME this might trigger a DOM change and a recursive call to setState. Need some strategy for dealing with that
    let updated = this.docView.update(state)
    if (updated) this.scheduleLayoutCheck()
  }

  // FIXME move to docviewdesc?
  private scheduleLayoutCheck() {
    if (this.layoutCheckScheduled == null)
      this.layoutCheckScheduled = requestAnimationFrame(() => {
        this.layoutCheckScheduled = null
        this.docView.checkLayout()
      })
  }

  // FIXME this is very awkward to type. Change or embrace the any?
  someProp(propName: string, f: ((value: any) => any) | undefined = undefined): any {
    let plugins = this.state.plugins, value
    for (let plugin of plugins) {
      let prop = plugin.props[propName]
      if (prop != null && (value = f ? f(prop) : prop)) return value
    }
    return null
  }

  domAtPos(pos: number): {node: Node, offset: number} | null {
    return this.docView.domFromPos(pos)
  }

  hasFocus(): boolean {
    return getRoot(this.dom).activeElement == this.contentDOM
  }

  focus() {
    this.docView.updateSelection(this.state.selection, true)
  }

  destroy() {
    cancelAnimationFrame(this.layoutCheckScheduled!)
    this.dom.remove()
    this.docView.destroy()
  }
}

export interface EditorProps {
  readonly handleDOMEvents?: {[key: string]: (view: EditorView, event: Event) => boolean};
  readonly decorations?: (state: EditorState) => DecorationSet;
}

function selectionFromDOM(view: EditorView) {
  let domSel = getRoot(view.contentDOM).getSelection()
  let head = view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset)
  let anchor = selectionCollapsed(domSel) ? head : view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset)
  return Selection.single(anchor, head)
}

function applySelectionChange(view: EditorView) {
  let selection = selectionFromDOM(view)
  if (!view.state.selection.eq(selection)) {
    let tr = view.state.transaction.setSelection(selection)
    if (view.inputState.lastSelectionTime > Date.now() - 50) tr = tr.setMeta(MetaSlot.origin, view.inputState.lastSelectionOrigin)
    view.dispatch(tr)
  }
  view.inputState.lastSelectionTime = 0
}
