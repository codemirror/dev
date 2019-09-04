import {EditorState, Transaction} from "../../state/src"
import {BehaviorStore, Slot, Extension} from "../../extension/src/extension"
import {StyleModule} from "style-mod"

import {DocView} from "./docview"
import {InputState, MouseSelectionUpdate} from "./input"
import {Rect} from "./dom"
import {applyDOMChange} from "./domchange"
import {movePos, posAtCoords} from "./cursor"
import {BlockInfo} from "./heightmap"
import {Viewport} from "./viewport"
import {extendView, ViewField, viewField, ViewUpdate, styleModule,
        viewPlugin, ViewPlugin, getField, Effect, themeClass, notified} from "./extension"
import {Attrs, combineAttrs, updateAttrs} from "./attributes"
import {styles} from "./styles"

/// Configuration parameters passed when creating an editor view.
export interface EditorConfig {
  /// The view's initial state.
  state: EditorState,
  /// Extra extensions (beyond those associated with the state) to
  /// use.
  extensions?: Extension[],
  /// If the view is going to be mounted in a shadow root or document
  /// other than the one held by the global variable `document` (the
  /// default), you should pass it here.
  root?: Document | ShadowRoot,
  /// Override the transaction dispatch function for this editor view.
  /// Your implementation, if provided, should probably call the
  /// view's `update` method.
  dispatch?: (tr: Transaction) => void
}

/// An editor view represents the editor's user interface. It holds
/// the editable DOM surface, and possibly other elements such as the
/// line number gutter. It handles events and dispatches state
/// transactions for editing actions.
export class EditorView {
  /// The current editor state.
  public state!: EditorState
  /// The part of the document (plus possibly a margin around it) that
  /// is visible to the user.
  public viewport!: Viewport

  /// All regular editor state updates should go through this. It
  /// takes a transaction, applies it, and updates the view to show
  /// the new state. Its implementation can be overridden with an
  /// [option](#view.EditorConfig.dispatch). Does not have to be
  /// called as a method.
  readonly dispatch: (tr: Transaction) => void

  /// The document or shadow root that the view lives in. Mostly
  /// relevant when inspecting the DOM selection, where you'll want to
  /// call `getSelection` on this, rather than the global `document`
  /// or `window` objects, to ensure you get the right selection.
  readonly root: DocumentOrShadowRoot

  /// The DOM element that wraps the entire editor view.
  readonly dom: HTMLElement

  /// The editable DOM element holding the editor content. You should
  /// not, usually, interact with this content directly, though the
  /// DOM, since the editor will immediately undo most of the changes
  /// you make. Instead, use transactions to modify content, and
  /// [decorations](#view.Decoration) to style it.
  readonly contentDOM: HTMLElement

  /// @internal
  inputState!: InputState

  /// @internal
  readonly docView: DocView

  /// The behavior stored in the view by extensions. Note that _state_
  /// behavior will be in `.state.behavior` instead.
  readonly behavior!: BehaviorStore

  /// @internal
  fields!: ReadonlyArray<ViewField<any>>
  /// @internal
  fieldValues!: any[]

  private plugins: ViewPlugin[] = []
  private editorAttrs: AttrsFor
  private contentAttrs: AttrsFor

  /// @internal
  updating: boolean = false

  /// @internal
  notifications: (Promise<any> & {canceled?: boolean})[] = []

  /// Update the view when the given promise resolves. Sets its
  /// `canceled` property when another factor causes the update.
  notify: (promise: Promise<any> & {canceled?: boolean}) => void

  /// The view extension type, used to define new view extensions.
  static extend = extendView

  /// Construct a new view. You'll usually want to put `view.dom` into
  /// your document after creating a view, so that the user can see
  /// it.
  constructor(config: EditorConfig) {
    this.contentDOM = document.createElement("div")
    let tabSizeStyle = (this.contentDOM.style as any).tabSize != null ? "tab-size: " : "-moz-tab-size: "
    this.contentAttrs = new AttrsFor(ViewField.contentAttributeEffect, this.contentDOM, () => ({
      spellcheck: "false",
      contenteditable: "true",
      class: styles.content + " codemirror-content " + this.themeClass("editor.content"),
      style: tabSizeStyle + this.state.tabSize
    }))

    this.dom = document.createElement("div")
    this.dom.appendChild(this.contentDOM)
    this.editorAttrs = new AttrsFor(ViewField.editorAttributeEffect, this.dom, view => ({
      class: "codemirror " + styles.wrapper + (view.hasFocus ? " codemirror-focused " : " ") + this.themeClass("editor.wrapper")
    }))

    this.dispatch = config.dispatch || ((tr: Transaction) => this.update([tr]))
    this.root = (config.root || document) as DocumentOrShadowRoot

    this.notify = (promise) => {
      promise.then(() => {
        if (!promise.canceled) this.update([], [notified(true)])
      })
      this.notifications.push(promise)
    }

    this.docView = new DocView(this, (start, end, typeOver) => applyDOMChange(this, start, end, typeOver))
    this.setState(config.state, config.extensions)
  }

  /// Reset the view to a given state. This is more expensive then
  /// updating it with transactions, since it requires a redraw of the
  /// content and a reset of the view extensions.
  setState(state: EditorState, extensions: Extension[] = []) {
    this.clearNotifications()
    for (let plugin of this.plugins) if (plugin.destroy) plugin.destroy()
    this.withUpdating(() => {
      ;(this as any).behavior = extendView.resolve(extensions.concat(state.behavior.foreign))
      this.fields = this.behavior.get(viewField)
      StyleModule.mount(this.root, this.behavior.get(styleModule).concat(styles).reverse())
      if (this.behavior.foreign.length)
        throw new Error("Non-view extensions found when setting view state")
      this.inputState = new InputState(this)
      this.docView.init(state)
      this.plugins = this.behavior.get(viewPlugin).map(spec => spec(this))
      this.contentAttrs.update(this)
      this.editorAttrs.update(this)
    })
  }

  /// Update the view for the given array of transactions. This will
  /// update the visible document and selection to match the state
  /// produced by the transactions, and notify view fields and plugins
  /// of the change.
  update(transactions: Transaction[] = [], metadata: Slot[] = []) {
    this.clearNotifications()
    let state = this.state
    for (let tr of transactions) {
      if (tr.startState != state)
        throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
      state = tr.apply()
    }
    this.withUpdating(() => {
      let update = transactions.length > 0 || metadata.length > 0 ? new ViewUpdate(this, transactions, metadata) : null
      if (state.doc != this.state.doc || transactions.some(tr => tr.selectionSet && !tr.getMeta(Transaction.preserveGoalColumn)))
        this.inputState.goalColumns.length = 0
      this.docView.update(update, transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
      if (update) {
        this.inputState.update(update)
        this.updatePlugins(update)
        this.contentAttrs.update(this)
        this.editorAttrs.update(this)
      }
    })
  }

  private clearNotifications() {
    for (let promise of this.notifications) promise.canceled = true
    this.notifications.length = 0
  }

  /// @internal
  updatePlugins(update: ViewUpdate) {
    for (let plugin of this.plugins) if (plugin.update) plugin.update(update)
  }

  /// @internal
  initInner(state: EditorState, viewport: Viewport) {
    this.viewport = viewport
    this.state = state
    this.fieldValues = []
    for (let field of this.fields) this.fieldValues.push(field.create(this))
  }

  /// @internal
  updateInner(update: ViewUpdate, viewport: Viewport) {
    this.viewport = viewport
    this.state = update.state
    this.fieldValues = []
    for (let i = 0; i < this.fields.length; i++)
      this.fieldValues.push(this.fields[i].update(update.prevFieldValues[i], update))
  }

  /// @internal
  withUpdating(f: () => void) {
    if (this.updating)
      throw new Error("Calls to EditorView.update or EditorView.setState are not allowed in extension update or create methods")
    this.updating = true
    try { f() }
    finally { this.updating = false }
  }

  /// Retrieve the value of the given [view field](#view.ViewField).
  /// If the field isn't present and no default value is given, this
  /// will raise an exception.
  getField<T>(field: ViewField<T>): T;
  getField<T, D = undefined>(field: ViewField<T>, defaultValue?: D): T | D {
    return getField(field, this.fields, this.fieldValues, defaultValue)
  }

  /// Get the values available for the given effect.
  getEffect<V>(type: Effect<V>): ReadonlyArray<V> {
    let result: V[] = []
    for (let i = 0; i < this.fieldValues.length; i++) {
      let accessor = Slot.get(type, this.fields[i].effects)
      if (accessor) result.push(accessor(this.fieldValues[i]) as V)
    }
    return result
  }

  /// Query the active themes for the CSS class names associated with
  /// the given tag. (FIXME)
  themeClass(tag: string): string {
    let result = ""
    for (let theme of this.behavior.get(themeClass)) {
      let cls = theme(tag)
      if (cls) result += (result ? " " + cls : cls)
    }
    return result
  }

  /// Find the DOM parent node and offset (child offset if `node` is
  /// an element, character offset when it is a text node) at the
  /// given document position.
  domAtPos(pos: number): {node: Node, offset: number} {
    return this.docView.domAtPos(pos)
  }

  /// Find the line or block widget at the given vertical position.
  /// `editorTop`, if given, provides the vertical position of the top
  /// of the editor. It defaults to the editor's screen position
  /// (which will force a DOM layout).
  blockAtHeight(height: number, editorTop?: number) {
    this.docView.forceLayout()
    return this.docView.blockAtHeight(height, editorTop)
  }

  /// Find information for the line at the given vertical position.
  /// The resulting block info might hold another array of block info
  /// structs in its `type` field if this line consists of more than
  /// one block.
  lineAtHeight(height: number, editorTop?: number): BlockInfo {
    this.docView.forceLayout()
    return this.docView.lineAtHeight(height, editorTop)
  }

  /// Find the height information for the given line.
  lineAt(pos: number, editorTop?: number): BlockInfo {
    this.docView.forceLayout()
    return this.docView.lineAt(pos, editorTop)
  }

  /// Iterate over the height information of the lines in the
  /// viewport.
  viewportLines(f: (height: BlockInfo) => void, editorTop?: number) {
    let {from, to} = this.viewport
    this.docView.forEachLine(from, to, f, editorTop)
  }

  /// The editor's total content height.
  get contentHeight() {
    return this.docView.heightMap.height + this.docView.paddingTop + this.docView.paddingBottom
  }

  /// Compute cursor motion from the given position, in the given
  /// direction, by the given unit. Since this might involve
  /// temporarily mutating the DOM selection, you can pass the action
  /// type this will be used for to, in case the editor selection is
  /// set to the new position right away, avoid an extra DOM selection
  /// change.
  movePos(start: number, direction: "forward" | "backward" | "left" | "right",
          granularity: "character" | "word" | "line" | "lineboundary" = "character",
          action: "move" | "extend" = "move"): number {
    return movePos(this, start, direction, granularity, action)
  }

  /// Get the document position at the given screen coordinates.
  posAtCoords(coords: {x: number, y: number}): number {
    this.docView.forceLayout()
    return posAtCoords(this, coords)
  }

  /// Get the screen coordinates at the given document position.
  coordsAtPos(pos: number): Rect | null { return this.docView.coordsAt(pos) }

  /// The default width of a character in the editor. May not
  /// accurately reflect the width of all characters.
  get defaultCharacterWidth() { return this.docView.heightOracle.charWidth }
  /// The default height of a line in the editor.
  get defaultLineHeight() { return this.docView.heightOracle.lineHeight }

  /// Start a custom mouse selection event.
  startMouseSelection(event: MouseEvent, update: MouseSelectionUpdate) {
    this.focus()
    this.inputState.startMouseSelection(this, event, update)
  }

  /// Check whether the editor has focus.
  get hasFocus(): boolean {
    return this.root.activeElement == this.contentDOM
  }

  /// Put focus on the editor.
  focus() {
    this.docView.focus()
  }

  /// Clean up this editor view, removing its element from the
  /// document, unregistering event handlers, and notifying
  /// extensions. The view instance can no longer be used after
  /// calling this.
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
