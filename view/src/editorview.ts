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

export class ViewSlot<S> {
  // @internal
  constructor(/* @internal */ public type: any,
              /* @internal */ public accessor: (state: S) => any) {}

  static define<V>() {
    let type = {}
    return {
      slot<S>(accessor: (state: S) => V): ViewSlot<S> {
        return new ViewSlot<S>(type, accessor)
      },
      get(view: EditorView) {
        let result: V[] = []
        for (let field of view.behavior.get(viewField)) {
          for (let slot of field.slots)
            if (slot.type == type) result.push(slot.accessor(view.getField(field)) as V)
        }
        return result
      }
    }
  }
}

const decorationSlot = ViewSlot.define<DecorationSet>()

export class ViewField<S> {
  create: (state: EditorState) => S
  update: (state: S, update: ViewUpdate) => S
  slots: ViewSlot<S>[]
  extension: ViewExtension
  
  constructor({create, update, slots = []}: {
    create: (state: EditorState) => S,
    update: (value: S, update: ViewUpdate) => S,
    slots?: ViewSlot<S>[]
  }) {
    this.create = create; this.update = update; this.slots = slots
    this.extension = viewField(this)
  }

  static decorations({create, update, map}: {
    create?: (state: EditorState) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    return new ViewField<DecorationSet>({
      create: create || (() => Decoration.none),
      update(deco: DecorationSet, u: ViewUpdate) {
        if (map) for (let tr of u.transactions) deco = deco.map(tr.changes)
        return update(deco, u)
      },
      slots: [decorationSlot.slot(d => d)]
    }).extension
  }

  static decorationSlot = decorationSlot.slot
}

export class ViewExtension extends Extension {
  static handleDOMEvents = ViewExtension.defineBehavior<{[key: string]: (view: EditorView, event: any) => boolean}>()

  static domEffect = ViewExtension.defineBehavior<(view: EditorView) => DOMEffect>()

  static styleModules = ViewExtension.defineBehavior<StyleModule>()
}

const viewField = ViewExtension.defineBehavior<ViewField<any>>()

export type DOMEffect = {
  update?: () => void
  destroy?: () => void
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
  private fields!: any[]
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
        let fields = this.behavior.get(viewField)
        for (let i = 0; i < fields.length; i++)
          this.fields[i] = fields[i].update(this.fields[i], update)
      },
      onInitDOM: () => {
        this.domEffects = this.behavior.get(ViewExtension.domEffect).map(spec => spec(this))
      },
      onUpdateDOM: () => {
        for (let spec of this.domEffects) if (spec.update) spec.update()
      },
      getDecorations: () => decorationSlot.get(this)
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
      this.fields = this.behavior.get(viewField).map(field => field.create(this.state))
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

  getField<S>(field: ViewField<S>): S {
    let index = this.behavior.get(viewField).indexOf(field)
    if (index < 0) throw new RangeError("Field isn't present in this view")
    return this.fields[index] as S
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
