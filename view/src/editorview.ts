import {EditorState, Transaction} from "../../state/src"
import {BehaviorStore, Slot} from "../../extension/src/extension"
import {StyleModule} from "style-mod"

import {DocView} from "./docview"
import {InputState, MouseSelectionUpdate} from "./input"
import {Rect} from "./dom"
import {applyDOMChange} from "./domchange"
import {movePos, posAtCoords} from "./cursor"
import {LineHeight} from "./heightmap"
import {ViewExtension, ViewFields, viewField, ViewUpdate, styleModule, viewPlugin, ViewPlugin} from "./extension"

export interface EditorConfig {
  state: EditorState,
  extensions?: ViewExtension[],
  root?: Document | ShadowRoot,
  dispatch?: (tr: Transaction) => void
}

export class EditorView {
  get state() { return this.fields.state }
  get viewport() { return this.fields.viewport }

  dispatch: (tr: Transaction) => void
  root: DocumentOrShadowRoot

  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  // @internal
  inputState!: InputState

  // @internal
  readonly docView: DocView

  readonly behavior!: BehaviorStore
  readonly fields!: ViewFields
  private plugins: ViewPlugin[] = []

  private updatingState: boolean = false

  constructor(config: EditorConfig) {
    this.contentDOM = document.createElement("div")
    this.contentDOM.className = "codemirror-content " + styles.content
    this.contentDOM.setAttribute("contenteditable", "true")
    this.contentDOM.setAttribute("spellcheck", "false") // FIXME configurable

    this.dom = document.createElement("div")
    this.dom.className = "codemirror " + styles.wrapper
    this.dom.appendChild(this.contentDOM)

    this.dispatch = config.dispatch || ((tr: Transaction) => this.updateState([tr], tr.apply()))
    this.root = (config.root || document) as DocumentOrShadowRoot

    this.docView = new DocView(this.contentDOM, this.root, {
      onDOMChange: (start, end, typeOver) => applyDOMChange(this, start, end, typeOver),
      updateFields: (state, viewport, transactions, slots) => {
        return (this as any).fields = this.fields
          ? this.fields.update(state, viewport, transactions, slots)
          : ViewFields.create(this.behavior.get(viewField), state, viewport, this)
      },
      onInitDOM: () => {
        this.plugins = this.behavior.get(viewPlugin).map(spec => spec(this))
      },
      onUpdateDOM: (update: ViewUpdate) => {
        for (let plugin of this.plugins) if (plugin.update) plugin.update(update)
      }
    })
    this.setState(config.state, config.extensions)
  }

  setState(state: EditorState, extensions: ViewExtension[] = []) {
    for (let plugin of this.plugins) if (plugin.destroy) plugin.destroy()
    this.withUpdating(() => {
      setTabSize(this.contentDOM, state.tabSize)
      ;(this as any).behavior = ViewExtension.resolve(extensions.concat(state.behavior.foreign))
      StyleModule.mount(this.root, styles)
      for (let s of this.behavior.get(styleModule)) StyleModule.mount(this.root, s)
      if (this.behavior.foreign.length)
        throw new Error("Non-ViewExtension extensions found when setting view state")
      this.inputState = new InputState(this)
      this.docView.init(state)
    })
  }

  // FIXME rename this to update at some point, make state implicit in transactions
  updateState(transactions: Transaction[], state: EditorState, updateSlots: Slot[] = []) {
    if (transactions.length && transactions[0].startState != this.state)
      throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
    this.withUpdating(() => {
      let prevState = this.state
      if (transactions.some(tr => tr.getSlot(Transaction.changeTabSize) != undefined)) setTabSize(this.contentDOM, state.tabSize)
      if (state.doc != prevState.doc || transactions.some(tr => tr.selectionSet && !tr.getSlot(Transaction.preserveGoalColumn)))
        this.inputState.goalColumns.length = 0
      this.docView.update(transactions, state, updateSlots,
                          transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
      this.inputState.update(transactions)
    })
  }

  private withUpdating(f: () => void) {
    if (this.updatingState) throw new Error("Recursive calls of EditorView.updateState or EditorView.setState are not allowed")
    this.updatingState = true
    try { f() }
    finally { this.updatingState = false }
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

  viewportLines(f: (height: LineHeight) => void) {
    let {from, to} = this.viewport
    this.docView.heightMap.forEachLine(from, to, 0, this.docView.heightOracle, f)
  }

  startMouseSelection(event: MouseEvent, update: MouseSelectionUpdate) {
    this.focus()
    this.inputState.startMouseSelection(this, event, update)
  }

  hasFocus(): boolean {
    return this.root.activeElement == this.contentDOM
  }

  focus() {
    this.docView.focus()
  }

  destroy() {
    for (let plugin of this.plugins) if (plugin.destroy) plugin.destroy()
    this.inputState.destroy()
    this.dom.remove()
    this.docView.destroy()
  }
}

function setTabSize(elt: HTMLElement, size: number) {
  (elt.style as any).tabSize = (elt.style as any).MozTabSize = size
}

const styles = new StyleModule({
  wrapper: {
    position: "relative !important",
    display: "flex !important",
    alignItems: "flex-start !important",
    fontFamily: "monospace",
    lineHeight: 1.4,

    "&.focused": {
      // FIXME it would be great if we could directly use the browser's
      // default focus outline, but it appears we can't, so this tries to
      // approximate that
      outline_fallback: "1px dotted #212121",
      outline: "5px auto -webkit-focus-ring-color"
    }
  },

  content: {
    margin: 0,
    flexGrow: 2,
    minHeight: "100%",
    display: "block",
    whiteSpace: "pre",
    boxSizing: "border-box",

    padding: "4px 2px 4px 4px",
    outline: "none",
    caretColor: "black",

    "& codemirror-line": {
      display: "block"
    }
  }
}, {priority: 0})
