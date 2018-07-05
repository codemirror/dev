import {EditorState, Transaction, EditorSelection, MetaSlot} from "../../state/src"
import {DocView} from "./docview"
import {InputState} from "./input"
import {getRoot, selectionCollapsed} from "./dom"
import {DecorationSet} from "./decoration"
import {applyDOMChange} from "./domchange"

export class EditorView {
  private _state: EditorState
  get state(): EditorState { return this._state }

  readonly dispatch: (tr: Transaction) => void

  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  /** @internal */
  readonly inputState: InputState

  /** @internal */
  readonly docView: DocView

  readonly viewport: EditorViewport

  private pluginViews: PluginView[] = []

  constructor(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined = undefined) {
    this._state = state
    this.dispatch = dispatch || (tr => this.setState(tr.apply()))

    this.contentDOM = document.createElement("pre")
    this.contentDOM.className = "CodeMirror-content"
    this.contentDOM.style.cssText = contentCSS
    this.contentDOM.setAttribute("contenteditable", "true")
    this.contentDOM.setAttribute("spellcheck", "false")

    this.dom = document.createElement("div")
    this.dom.style.cssText = editorCSS
    this.dom.className = "CodeMirror"
    this.dom.appendChild(this.contentDOM)

    this.inputState = new InputState(this)

    this.docView = new DocView(this.contentDOM, (start, end, typeOver) => applyDOMChange(this, start, end, typeOver),
                               () => applySelectionChange(this), () => this.layoutChange())
    this.docView.update(state)
    this.viewport = new EditorViewport(this.docView)
    this.createPluginViews()
  }

  setState(state: EditorState) {
    let prevState = this._state
    // FIXME scroll selection into view when needed
    this._state = state
    this.docView.update(state)
    if (prevState.plugins != state.plugins) {
      this.inputState.updateCustomHandlers(this)
      this.createPluginViews()
    } else {
      for (let pluginView of this.pluginViews) if (pluginView.update) pluginView.update(this, prevState)
    }
  }

  /** @internal */
  someProp<N extends keyof EditorProps, R>(propName: N, f: (value: NonNullable<EditorProps[N]>) => R | undefined): R | undefined {
    let value: R | undefined = undefined
    for (let plugin of this.state.plugins) {
      let prop = plugin.props[propName]
      if (prop != null && (value = f(prop)) != null) break
    }
    return value
  }

  /** @internal */
  getProp<N extends keyof EditorProps>(propName: N): EditorProps[N] {
    for (let plugin of this.state.plugins) {
      let prop = plugin.props[propName]
      if (prop != null) return prop
    }
    return undefined
  }

  private createPluginViews() {
    this.destroyPluginViews()
    for (let plugin of this.state.plugins) if (plugin.view)
      this.pluginViews.push(plugin.view(this))
  }

  private destroyPluginViews() {
    for (let pluginView of this.pluginViews) if (pluginView.destroy)
      pluginView.destroy()
    this.pluginViews.length = 0
  }

  private layoutChange() {
    for (let pluginView of this.pluginViews) if (pluginView.layoutChange)
      pluginView.layoutChange(this)
  }

  domAtPos(pos: number): {node: Node, offset: number} | null {
    return this.docView.domFromPos(pos)
  }

  heightAtPos(pos: number, top: boolean): number {
    return this.docView.heightMap.heightAt(pos, top ? -1 : 1)
  }

  hasFocus(): boolean {
    return getRoot(this.dom).activeElement == this.contentDOM
  }

  focus() {
    this.docView.focus()
  }

  destroy() {
    this.destroyPluginViews()
    this.dom.remove()
    this.docView.destroy()
  }
}

export interface EditorProps {
  readonly handleDOMEvents?: {[key: string]: (view: EditorView, event: Event) => boolean};
  readonly decorations?: (state: EditorState) => DecorationSet;
}

export interface PluginView {
  update?: (view: EditorView, prevState: EditorState) => void
  layoutChange?: (view: EditorView) => void
  destroy?: () => void
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

const editorCSS = `
position: relative;
display: flex;
align-items: stretch;`

const contentCSS = `
margin: 0;
flex-grow: 2;`

// Public shim for giving client code access to viewport information
export class EditorViewport {
  /** @internal */
  constructor(readonly docView: DocView) {}

  get from() { return this.docView.visiblePart.from }
  get to() { return this.docView.visiblePart.to }

  forEachLine(f: (from: number, to: number, line: {readonly height: number, readonly hasCollapsedRanges: boolean}) => void) {
    this.docView.heightMap.forEachLine(this.from, this.to, 0, this.docView.heightOracle, f)
  }
}
