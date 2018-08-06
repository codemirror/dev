import {EditorState, Transaction, EditorSelection, MetaSlot} from "../../state/src"
import {DocView} from "./docview"
import {InputState} from "./input"
import {getRoot, selectionCollapsed} from "./dom"
import {Decoration, DecorationSet} from "./decoration"
import {applyDOMChange} from "./domchange"
import {changedRanges} from "./changes"

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

  constructor(state: EditorState, dispatch?: ((tr: Transaction) => void | null), ...plugins: PluginView[]) {
    this._state = state
    this.dispatch = dispatch || (tr => this.updateState([tr], tr.apply()))

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
    this.viewport = new EditorViewport(this.docView)
    this.createPluginViews(plugins)
    this.docView.update(state.doc, state.selection, this.decorations)
  }

  setState(state: EditorState, ...plugins: PluginView[]) {
    this._state = state
    this.docView.update(state.doc, state.selection, this.decorations)
    this.inputState.updateCustomHandlers(this)
    this.createPluginViews(plugins)
  }

  updateState(transactions: Transaction[], state: EditorState) {
    if (transactions.length && transactions[0].startState != this._state)
      throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
    let prevState = this._state
    this._state = state
    for (let pluginView of this.pluginViews)
      if (pluginView.updateState) pluginView.updateState(this, prevState, transactions)
    this.docView.update(state.doc, state.selection, this.decorations, changedRanges(transactions),
                        transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
    for (let pluginView of this.pluginViews)
      if (pluginView.updateDOM) pluginView.updateDOM(this)
  }

  /** @internal */
  someProp<N extends keyof PluginView, R>(propName: N, f: (value: NonNullable<PluginView[N]>) => R | undefined): R | undefined {
    let value: R | undefined = undefined
    for (let pluginView of this.pluginViews) {
      let prop = pluginView[propName]
      if (prop != null && (value = f(prop as NonNullable<PluginView[N]>)) != null) break
    }
    return value
  }

  /** @internal */
  getProp<N extends keyof PluginView>(propName: N): PluginView[N] {
    for (let pluginView of this.pluginViews) {
      let prop = pluginView[propName]
      if (prop != null) return prop
    }
    return undefined
  }

  private createPluginViews(plugins: PluginView[]) {
    this.destroyPluginViews()
    for (let plugin of plugins) this.pluginViews.push(plugin)
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
    return this.docView.heightMap.heightAt(pos, this.state.doc, top ? -1 : 1)
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

  private get decorations(): DecorationSet[] {
    return this.pluginViews.map(v => v.decorations || Decoration.none)
  }
}

export interface PluginView {
  updateState?: (view: EditorView, prevState: EditorState, transactions: Transaction[]) => void
  updateDOM?: (view: EditorView) => void
  handleDOMEvents?: {[key: string]: (view: EditorView, event: Event) => boolean};
  decorations?: DecorationSet;
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
align-items: flex-start;`

const contentCSS = `
margin: 0;
flex-grow: 2;
min-height: 100%;`

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
