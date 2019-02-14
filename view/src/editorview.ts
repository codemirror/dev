import {EditorState, Transaction} from "../../state/src"
import {BehaviorStore, Slot} from "../../extension/src/extension"
import {StyleModule} from "style-mod"

import {DocView} from "./docview"
import {InputState, MouseSelectionUpdate} from "./input"
import {Rect} from "./dom"
import {applyDOMChange} from "./domchange"
import {movePos, posAtCoords} from "./cursor"
import {LineHeight, BlockInfo} from "./heightmap"
import {Viewport} from "./viewport"
import {ViewExtension, ViewField, viewField, ViewUpdate, styleModule, ViewSnapshot,
        viewPlugin, ViewPlugin, getField, Effect} from "./extension"
import {Attrs, combineAttrs, updateAttrs} from "./attributes"

export interface EditorConfig {
  state: EditorState,
  extensions?: ViewExtension[],
  root?: Document | ShadowRoot,
  dispatch?: (tr: Transaction) => void
}

export class EditorView {
  public state!: EditorState
  public viewport!: Viewport

  dispatch: (tr: Transaction) => void
  root: DocumentOrShadowRoot

  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  // @internal
  inputState!: InputState

  // @internal
  readonly docView: DocView

  readonly behavior!: BehaviorStore
  // @internal
  fields!: ReadonlyArray<ViewField<any>>
  // @internal
  fieldValues!: any[]
  private plugins: ViewPlugin[] = []
  private editorAttrs: AttrsFor
  private contentAttrs: AttrsFor

  // @internal
  updating: boolean = false

  constructor(config: EditorConfig) {
    this.contentDOM = document.createElement("div")
    let tabSizeStyle = (this.contentDOM.style as any).tabSize != null ? "tab-size: " : "-moz-tab-size: "
    this.contentAttrs = new AttrsFor(ViewField.contentAttributeEffect, this.contentDOM, () => ({
      spellcheck: "false",
      contenteditable: "true",
      class: "codemirror-content " + styles.content,
      style: tabSizeStyle + this.state.tabSize
    }))

    this.dom = document.createElement("div")
    this.dom.appendChild(this.contentDOM)
    this.editorAttrs = new AttrsFor(ViewField.editorAttributeEffect, this.dom, view => ({
      class: "codemirror " + styles.wrapper + (view.hasFocus() ? " codemirror-focused" : "")
    }))

    this.dispatch = config.dispatch || ((tr: Transaction) => this.updateState([tr], tr.apply()))
    this.root = (config.root || document) as DocumentOrShadowRoot

    this.docView = new DocView(this, (start, end, typeOver) => applyDOMChange(this, start, end, typeOver))
    this.setState(config.state, config.extensions)
  }

  setState(state: EditorState, extensions: ViewExtension[] = []) {
    for (let plugin of this.plugins) if (plugin.destroy) plugin.destroy()
    this.withUpdating(() => {
      ;(this as any).behavior = ViewExtension.resolve(extensions.concat(state.behavior.foreign))
      this.fields = this.behavior.get(viewField)
      StyleModule.mount(this.root, styles)
      for (let s of this.behavior.get(styleModule)) StyleModule.mount(this.root, s)
      if (this.behavior.foreign.length)
        throw new Error("Non-ViewExtension extensions found when setting view state")
      this.inputState = new InputState(this)
      this.docView.init(state)
      this.plugins = this.behavior.get(viewPlugin).map(spec => spec(this))
      this.contentAttrs.update(this)
      this.editorAttrs.update(this)
    })
  }

  // FIXME rename this to update at some point, make state implicit in transactions
  updateState(transactions: Transaction[], state: EditorState, metadata: Slot[] = []) {
    if (transactions.length && transactions[0].startState != this.state)
      throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
    this.withUpdating(() => {
      let snapshot = new ViewSnapshot(this)
      if (state.doc != this.state.doc || transactions.some(tr => tr.selectionSet && !tr.getMeta(Transaction.preserveGoalColumn)))
        this.inputState.goalColumns.length = 0
      this.docView.update(transactions, state, metadata,
                          transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
      this.inputState.update(transactions)
      this.updatePlugins(new ViewUpdate(snapshot, transactions, this, metadata))
      this.contentAttrs.update(this)
      this.editorAttrs.update(this)
    })
  }

  // @internal
  updatePlugins(update: ViewUpdate) {
    for (let plugin of this.plugins) if (plugin.update) plugin.update(update)
  }

  // @internal
  updateStateInner(state: EditorState, viewport: Viewport, transactions: ReadonlyArray<Transaction>, metadata: ReadonlyArray<Slot>) {
    if (this.fieldValues) {
      let snapshot = new ViewSnapshot(this)
      this.viewport = viewport
      this.state = state
      this.fieldValues = []
      let update = new ViewUpdate(snapshot, transactions, this, metadata)
      for (let i = 0; i < this.fields.length; i++)
        this.fieldValues.push(this.fields[i].update(snapshot.fieldValues[i], update))
    } else {
      this.viewport = viewport
      this.state = state
      this.fieldValues = []
      for (let field of this.fields) this.fieldValues.push(field.create(this))
    }
  }

  // @internal
  withUpdating(f: () => void) {
    if (this.updating)
      throw new Error("Calls to EditorView.updateState or EditorView.setState are not allowed in extension update or create methods")
    this.updating = true
    try { f() }
    finally { this.updating = false }
  }

  getField<T>(field: ViewField<T>): T;
  getField<T, D = undefined>(field: ViewField<T>, defaultValue?: D): T | D {
    return getField(field, this.fields, this.fieldValues, defaultValue)
  }

  getEffect<V>(type: Effect<V>): ReadonlyArray<V> {
    let result: V[] = []
    for (let i = 0; i < this.fieldValues.length; i++) {
      let accessor = Slot.get(type, this.fields[i].effects)
      if (accessor) result.push(accessor(this.fieldValues[i]) as V)
    }
    return result
  }

  domAtPos(pos: number): {node: Node, offset: number} | null {
    return this.docView.domFromPos(pos)
  }

  blockAtHeight(height: number, editorTop?: number) {
    this.docView.forceLayout()
    return this.docView.blockAtHeight(height, editorTop)
  }

  lineAtHeight(height: number, editorTop?: number): BlockInfo {
    this.docView.forceLayout()
    return this.docView.lineAtHeight(height, editorTop)
  }

  lineAt(pos: number, editorTop?: number): BlockInfo {
    this.docView.forceLayout()
    return this.docView.lineAt(pos, editorTop)
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

class AttrsFor {
  attrs: Attrs | null = null

  constructor(private effect: (accessor: (field: any) => (Attrs | null)) => Slot,
              private dom: HTMLElement,
              private deflt: (view: EditorView) => Attrs) {}

  update(view: EditorView) {
    let attrs = this.deflt(view)
    for (let spec of view.getEffect(this.effect)) if (spec) attrs = combineAttrs(spec, attrs)
    updateAttrs(this.dom, this.attrs, attrs)
    this.attrs = attrs
  }
}

const styles = new StyleModule({
  wrapper: {
    position: "relative !important",
    display: "flex !important",
    alignItems: "flex-start !important",
    fontFamily: "monospace",
    lineHeight: 1.4,

    "&.codemirror-focused": {
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
