import {EditorState, Transaction, MetaSlot, Behavior} from "../../state/src"
import {DocView, EditorViewport} from "./docview"
import {InputState, MouseSelectionUpdate} from "./input"
import {getRoot, Rect} from "./dom"
import {Decoration, DecorationSet} from "./decoration"
import {applyDOMChange} from "./domchange"
import {movePos, posAtCoords} from "./cursor"
import {LineHeight} from "./heightmap"

export const viewPlugin = Behavior.define<(view: EditorView) => PluginView>()

export class EditorView {
  private _state!: EditorState
  get state(): EditorState { return this._state }

  readonly dispatch: (tr: Transaction) => void

  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  // @internal
  inputState!: InputState

  // @internal
  readonly docView: DocView

  readonly viewport: EditorViewport

  private pluginViews: PluginView[] = []

  private updatingState: boolean = false

  constructor(state: EditorState, dispatch?: ((tr: Transaction) => void | null), ...plugins: PluginView[]) {
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
      onViewUpdate: (update: ViewUpdate) => {
        for (let pluginView of this.pluginViews)
          if (pluginView.update) pluginView.update(this, update)
      },
      onUpdateDOM: () => {
        for (let plugin of this.pluginViews) if (plugin.updateDOM) plugin.updateDOM(this)
      },
      getDecorations: () => this.pluginViews.map(v => v.decorations || Decoration.none)
    })
    this.viewport = this.docView.publicViewport
    this.setState(state, ...plugins)
  }

  setState(state: EditorState, ...plugins: PluginView[]) {
    this._state = state
    this.withUpdating(() => {
      setTabSize(this.contentDOM, state.tabSize)
      this.createPluginViews(plugins)
      this.inputState = new InputState(this)
      this.docView.init(state)
    })
  }

  updateState(transactions: Transaction[], state: EditorState) {
    if (transactions.length && transactions[0].startState != this._state)
      throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
    this.withUpdating(() => {
      let prevState = this._state
      this._state = state
      if (transactions.some(tr => tr.getMeta(MetaSlot.changeTabSize) != undefined)) setTabSize(this.contentDOM, state.tabSize)
      if (state.doc != prevState.doc || transactions.some(tr => tr.selectionSet && !tr.getMeta(MetaSlot.preserveGoalColumn)))
        this.inputState.goalColumns.length = 0
      this.docView.update(new ViewUpdate(transactions, prevState, state, true),
                          transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
      this.inputState.update(transactions)
    })
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

  private withUpdating(f: () => void) {
    if (this.updatingState) throw new Error("Recursive calls of EditorView.updateState or EditorView.setState are not allowed")
    this.updatingState = true
    try { f() }
    finally { this.updatingState = false }
  }

  private createPluginViews(plugins: PluginView[]) {
    this.destroyPluginViews()
    for (let plugin of plugins) this.pluginViews.push(plugin)
    for (let p of this.state.behavior(viewPlugin)) this.pluginViews.push(p(this))
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
    this.docView.forceLayout()
    return this.docView.heightAt(pos, top ? -1 : 1)
  }

  lineAtHeight(height: number): LineHeight {
    this.docView.forceLayout()
    return this.docView.lineAtHeight(height)
  }

  get contentHeight() {
    return this.docView.heightMap.height + this.docView.paddingTop + this.docView.paddingBottom
  }

  movePos(start: number, direction: "forward" | "backward" | "left" | "right",
          granularity: "character" | "word" | "line" | "lineboundary" = "character",
          action: "move" | "extend" = "move"): number {
    return movePos(this, start, direction, granularity, action)
  }

  posAtCoords(coords: {x: number, y: number}): number {
    this.docView.forceLayout()
    return posAtCoords(this, coords)
  }

  coordsAtPos(pos: number): Rect | null { return this.docView.coordsAt(pos) }

  get defaultCharacterWidth() { return this.docView.heightOracle.charWidth }
  get defaultLineHeight() { return this.docView.heightOracle.lineHeight }

  startMouseSelection(event: MouseEvent, update: MouseSelectionUpdate) {
    this.focus()
    this.inputState.startMouseSelection(this, event, update)
  }

  get root(): DocumentOrShadowRoot {
    return getRoot(this.dom)
  }

  hasFocus(): boolean {
    return getRoot(this.dom).activeElement == this.contentDOM
  }

  focus() {
    this.docView.focus()
  }

  destroy() {
    this.destroyPluginViews()
    this.inputState.destroy()
    this.dom.remove()
    this.docView.destroy()
  }
}

export class ViewUpdate {
  // FIXME more fields (focus, dragging, ...)
  // FIXME should scrollIntoView be stored in this?
  constructor(public transactions: ReadonlyArray<Transaction>,
              public oldState: EditorState,
              public state: EditorState,
              public viewportChanged: boolean) {}
}

export interface PluginView {
  update?: (view: EditorView, update: ViewUpdate) => void
  updateDOM?: (view: EditorView) => void
  handleDOMEvents?: {[key: string]: (view: EditorView, event: Event) => boolean}
  // This should return a stable value, not compute something on the fly
  decorations?: DecorationSet
  destroy?: () => void
}

function setTabSize(elt: HTMLElement, size: number) {
  (elt.style as any).tabSize = (elt.style as any).MozTabSize = size
}

const editorCSS = `
position: relative;
display: flex;
align-items: flex-start;`

const contentCSS = `
margin: 0;
flex-grow: 2;
min-height: 100%;`
