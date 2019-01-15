import {EditorState, Transaction, MetaSlot} from "../../state/src"
import {Extension, BehaviorStore} from "../../extension/src/extension"
import {DocView, EditorViewport, ViewUpdate} from "./docview"
import {InputState, MouseSelectionUpdate} from "./input"
import {getRoot, Rect} from "./dom"
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

  static dispatch = ViewExtension.defineBehavior<(view: EditorView, tr: Transaction) => boolean>()
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

export class EditorView {
  private _state!: EditorState
  get state(): EditorState { return this._state }

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

  constructor(state: EditorState, extensions: ViewExtension[] = []) {
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
        let specs = this.behavior.get(viewState)
        for (let i = 0; i < specs.length; i++)
          this.extState[i] = specs[i].update(this, update, this.extState[i])
      },
      onUpdateDOM: () => {
        for (let spec of this.domEffects) if (spec.update) spec.update()
      },
      getDecorations: () => getDecoratations(this)
    })
    this.viewport = this.docView.publicViewport
    this.setState(state, extensions)
  }

  setState(state: EditorState, extensions: ViewExtension[] = []) {
    for (let effect of this.domEffects) if (effect.destroy) effect.destroy()
    this._state = state
    this.withUpdating(() => {
      setTabSize(this.contentDOM, state.tabSize)
      this.behavior = ViewExtension.resolve(extensions.concat(state.behavior.foreign))
      if (this.behavior.foreign.length)
        throw new Error("Non-ViewExtension extensions found when setting view state")
      this.extState = this.behavior.get(viewState).map(spec => spec.create(this))
      this.inputState = new InputState(this)
      this.docView.init(state)
      this.domEffects = this.behavior.get(ViewExtension.domEffect).map(spec => spec(this))
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

  dispatch(tr: Transaction) {
    let handlers = this.behavior.get(ViewExtension.dispatch)
    for (let handler of handlers) if (handler(this, tr)) return
    this.updateState([tr], tr.apply())
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
    for (let effect of this.domEffects) if (effect.destroy) effect.destroy()
    this.inputState.destroy()
    this.dom.remove()
    this.docView.destroy()
  }
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
