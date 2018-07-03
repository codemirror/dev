import {EditorState, Transaction, EditorSelection, MetaSlot} from "../../state/src"
import {DocView} from "./docview"
import {InputState} from "./input"
import {getRoot, selectionCollapsed} from "./dom"
import {DecorationSet} from "./decoration"
import {applyDOMChange} from "./domchange"

export class EditorView {
  private _state: EditorState
  get state(): EditorState { return this._state }

  public dispatch: (tr: Transaction) => void

  public dom: HTMLElement
  public contentDOM: HTMLElement

  /** @internal */
  public inputState: InputState

  /** @internal */
  public docView: DocView;

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

    this.inputState = new InputState(this)

    this.docView = new DocView(this.contentDOM, (start, end, typeOver) => applyDOMChange(this, start, end, typeOver),
                               () => applySelectionChange(this))
    this.docView.update(state)
  }

  setState(state: EditorState) {
    let configChanged = !this._state.sameConfig(state)
    this._state = state
    this.docView.update(state)
    if (configChanged) this.inputState.updateCustomHandlers(this)
  }

  someProp<N extends keyof EditorProps, R>(propName: N, f: (value: NonNullable<EditorProps[N]>) => R | undefined): R | undefined {
    let value: R | undefined = undefined
    for (let plugin of this.state.plugins) {
      let prop = plugin.props[propName]
      if (prop != null && (value = f(prop)) != null) break
    }
    return value
  }

  getProp<N extends keyof EditorProps>(propName: N): EditorProps[N] {
    for (let plugin of this.state.plugins) {
      let prop = plugin.props[propName]
      if (prop != null) return prop
    }
    return undefined
  }

  domAtPos(pos: number): {node: Node, offset: number} | null {
    return this.docView.domFromPos(pos)
  }

  hasFocus(): boolean {
    return getRoot(this.dom).activeElement == this.contentDOM
  }

  focus() {
    this.docView.focus()
  }

  destroy() {
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
  return EditorSelection.single(anchor, head)
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
