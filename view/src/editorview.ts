import {EditorState, Transaction, MetaSlot} from "../../state/src"
import {Extension, BehaviorStore} from "../../extension/src/extension"
import {DocView, EditorViewport, ViewUpdate} from "./docview"
import {StyleModule} from "style-mod"
import {InputState, MouseSelectionUpdate} from "./input"
import {Rect} from "./dom"
import {Decoration, DecorationSet} from "./decoration"
import {applyDOMChange} from "./domchange"
import {movePos, posAtCoords} from "./cursor"
import {LineHeight} from "./heightmap"

export class ViewExtension extends Extension {
  static state<State>(spec: ViewStateSpec<State>, slots: ViewSlot<State>[] = []): ViewExtension {
    if (slots.length == 0) return viewState(spec)
    return viewStateWithSlots(spec, slots)
  }

  static decorations(spec: ViewStateSpec<DecorationSet> & {map?: boolean}) {
    let box = {value: Decoration.none}, map = spec.map !== false
    return ViewExtension.all(
      viewState({
        create(view) {
          return box.value = spec.create(view)
        },
        update(view, update, value) {
          if (map) for (let tr of update.transactions) value = value.map(tr.changes)
          return box.value = spec.update(view, update, value)
        }
      }),
      decorationBehavior(box)
    )
  }

  static defineSlot = defineViewSlot

  static decorationSlot: <State>(accessor: (state: State) => DecorationSet) => ViewSlot<State> = null as any

  static handleDOMEvents = ViewExtension.defineBehavior<{[key: string]: (view: EditorView, event: any) => boolean}>()

  static domEffect = ViewExtension.defineBehavior<(view: EditorView) => DOMEffect>()

  static styleModules = ViewExtension.defineBehavior<StyleModule>()
}

// FIXME does it make sense to isolate these from the actual view
// (only giving state, viewport etc)?
export interface ViewStateSpec<T> {
  create(view: EditorView): T
  update(view: EditorView, update: ViewUpdate, value: T): T
}

const viewState = ViewExtension.defineBehavior<ViewStateSpec<any>>()

export type DOMEffect = {
  update?: () => void
  destroy?: () => void
}

function defineViewSlot<T>() {
  let behavior = ViewExtension.defineBehavior<{value: T}>()
  return {
    // @internal
    behavior,
    get(view: EditorView): T[] {
      return view.behavior.get(behavior).map(box => box.value)
    },
    slot<State>(accessor: (state: State) => T) {
      return new ViewSlot(behavior, accessor)
    }
  }
}

export class ViewSlot<State> {
  constructor(/* @internal */ public behavior: (value: any) => ViewExtension,
              /* @internal */ public accessor: (state: State) => any) {}
}

const {behavior: decorationBehavior,
       get: getDecoratations,
       slot: decorationSlot} = defineViewSlot<DecorationSet>()

ViewExtension.decorationSlot = decorationSlot

function viewStateWithSlots<State>(spec: ViewStateSpec<State>, slots: ViewSlot<any>[]) {
  let boxes = slots.map(slot => ({value: null}))
  function save(value: any) {
    for (let i = 0; i < slots.length; i++)
      boxes[i].value = slots[i].accessor(value)
    return value
  }
  return ViewExtension.all(
    viewState({
      create(view) { return save(spec.create(view)) },
      update(view, update, value) { return save(spec.update(view, update, value)) }
    }),
    ...slots.map((slot, i) => slot.behavior(boxes[i]))
  )
}

export interface EditorConfig {
  state: EditorState,
  extensions?: ViewExtension[],
  root?: Document | ShadowRoot,
  dispatch?: (tr: Transaction) => void
}

export class EditorView {
  private _state!: EditorState
  get state(): EditorState { return this._state }

  dispatch: (tr: Transaction) => void
  root: DocumentOrShadowRoot

  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  // @internal
  inputState!: InputState

  // @internal
  readonly docView: DocView

  readonly viewport: EditorViewport

  public behavior!: BehaviorStore
  private extState!: any[]
  private domEffects: DOMEffect[] = []

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
      onViewUpdate: (update: ViewUpdate) => {
        let specs = this.behavior.get(viewState)
        for (let i = 0; i < specs.length; i++)
          this.extState[i] = specs[i].update(this, update, this.extState[i])
      },
      onInitDOM: () => {
        this.domEffects = this.behavior.get(ViewExtension.domEffect).map(spec => spec(this))
      },
      onUpdateDOM: () => {
        for (let spec of this.domEffects) if (spec.update) spec.update()
      },
      getDecorations: () => getDecoratations(this)
    })
    this.viewport = this.docView.publicViewport
    this.setState(config.state, config.extensions)
  }

  setState(state: EditorState, extensions: ViewExtension[] = []) {
    for (let effect of this.domEffects) if (effect.destroy) effect.destroy()
    this._state = state
    this.withUpdating(() => {
      setTabSize(this.contentDOM, state.tabSize)
      this.behavior = ViewExtension.resolve(extensions.concat(state.behavior.foreign))
      StyleModule.mount(this.root, styles)
      for (let s of this.behavior.get(ViewExtension.styleModules)) StyleModule.mount(this.root, s)
      if (this.behavior.foreign.length)
        throw new Error("Non-ViewExtension extensions found when setting view state")
      this.extState = this.behavior.get(viewState).map(spec => spec.create(this))
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
      this.docView.update(new ViewUpdate(transactions, prevState, state, false),
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

  extensionState<State>(spec: ViewStateSpec<State>): State | undefined {
    let index = this.behavior.get(viewState).indexOf(spec)
    if (index < 0) return undefined
    return this.extState[index]
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

  hasFocus(): boolean {
    return this.root.activeElement == this.contentDOM
  }

  focus() {
    this.docView.focus()
  }

  destroy() {
    for (let effect of this.domEffects) if (effect.destroy) effect.destroy()
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
