import {EditorState, Transaction, EditorSelection, MetaSlot} from "../../state/src"
import {DocView, EditorViewport} from "./docview"
import {InputState} from "./input"
import {getRoot, selectionCollapsed} from "./dom"
import {Decoration, DecorationSet} from "./decoration"
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

  private scheduledDecoUpdate: number = -1

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

    this.docView = new DocView(this.contentDOM, {
      onDOMChange: (start, end, typeOver) => applyDOMChange(this, start, end, typeOver),
      onSelectionChange: () => applySelectionChange(this),
      onUpdateState: (prevState: EditorState, transactions: Transaction[]) => {
        for (let pluginView of this.pluginViews)
          if (pluginView.updateState) pluginView.updateState(this, prevState, transactions)
      },
      onUpdateDOM: () => {
        for (let plugin of this.pluginViews) if (plugin.updateDOM) plugin.updateDOM(this)
      },
      onUpdateViewport: () => {
        for (let plugin of this.pluginViews) if (plugin.updateViewport) plugin.updateViewport(this)
      },
      getDecorations: () => this.pluginViews.map(v => v.decorations || Decoration.none)
    })
    this.viewport = this.docView.publicViewport
    this.createPluginViews(plugins)
    this.inputState = new InputState(this)
    this.docView.update(state)
  }

  setState(state: EditorState, ...plugins: PluginView[]) {
    this._state = state
    this.docView.update(state)
    this.inputState.updateCustomHandlers(this)
    this.createPluginViews(plugins)
  }

  // FIXME arrange for an error to be raised when this is called recursively
  updateState(transactions: Transaction[], state: EditorState) {
    if (transactions.length && transactions[0].startState != this._state)
      throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
    let prevState = this._state
    this._state = state
    this.docView.update(state, prevState, transactions, transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
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

  domAtPos(pos: number): {node: Node, offset: number} | null {
    return this.docView.domFromPos(pos)
  }

  heightAtPos(pos: number, top: boolean): number {
    return this.docView.heightAt(pos, top ? -1 : 1)
  }

  get contentHeight() {
    return this.docView.heightMap.height + this.docView.paddingTop + this.docView.paddingBottom
  }

  // To be used by plugin views when they update their decorations asynchronously
  decorationUpdate() {
    if (this.scheduledDecoUpdate < 0) this.scheduledDecoUpdate = requestAnimationFrame(() => {
      this.scheduledDecoUpdate = -1
      this.docView.update(this.state, this.state)
    })
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

export interface PluginView {
  updateState?: (view: EditorView, prevState: EditorState, transactions: Transaction[]) => void
  updateDOM?: (view: EditorView) => void
  updateViewport?: (view: EditorView) => void
  handleDOMEvents?: {[key: string]: (view: EditorView, event: Event) => boolean}
  // This should return a stable value, not compute something on the fly
  decorations?: DecorationSet
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
    if (view.inputState.lastSelectionTime > Date.now() - 50) {
      tr = tr.setMeta(MetaSlot.origin, view.inputState.lastSelectionOrigin)
      if (view.inputState.lastSelectionOrigin == "keyboard") tr = tr.scrollIntoView()
    }
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
