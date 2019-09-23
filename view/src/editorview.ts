import {EditorState, Transaction, CancellablePromise} from "../../state/src"
import {Configuration, Slot, Extension, IDMap, Behavior} from "../../extension/src/extension"
import {StyleModule} from "style-mod"

import {DocView} from "./docview"
import {InputState, MouseSelectionUpdate} from "./input"
import {Rect} from "./dom"
import {applyDOMChange} from "./domchange"
import {movePos, posAtCoords} from "./cursor"
import {BlockInfo} from "./heightmap"
import {Viewport} from "./viewport"
import {extendView, ViewUpdate, styleModule, themeClass, handleDOMEvents, focusChange,
        contentAttributes, editorAttributes, clickAddsSelectionRange, dragMovesSelection,
        viewPlugin, decorations, ViewPlugin, ViewPluginValue, notified} from "./extension"
import {Attrs, updateAttrs} from "./attributes"
import {styles} from "./styles"
import browser from "./browser"

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

  private extensions: readonly Extension[]
  /// @internal
  configuration!: Configuration<EditorView>

  /// @internal
  plugins: IDMap = new IDMap
  private editorAttrs: Attrs = {}
  private contentAttrs: Attrs = {}
  private styleModules!: readonly StyleModule[]

  /// @internal
  updating: boolean = false

  /// @internal
  waiting: CancellablePromise<any>[] = []

  /// The view extension type, used to define new view extensions.
  static extend = extendView

  /// Construct a new view. You'll usually want to put `view.dom` into
  /// your document after creating a view, so that the user can see
  /// it.
  constructor(config: EditorConfig) {
    this.contentDOM = document.createElement("div")

    this.dom = document.createElement("div")
    this.dom.appendChild(this.contentDOM)

    this.dispatch = config.dispatch || ((tr: Transaction) => this.update([tr]))
    this.root = (config.root || document) as DocumentOrShadowRoot

    this.docView = new DocView(this, (start, end, typeOver) => applyDOMChange(this, start, end, typeOver))

    this.extensions = config.extensions || []
    this.configure(config.state.configuration.foreign)
    this.inputState = new InputState(this)
    this.withUpdating(() => {
      this.docView.init(config.state, viewport => {
        this.viewport = viewport
        this.state = config.state
        for (let plugin of this.behavior(viewPlugin))
          this.plugins[plugin.id] = plugin.create(this)
      })
    })
    this.mountStyles()
    this.updateAttrs()
  }

  // Call a function on each plugin. If that crashes, disable the
  // plugin.
  private forEachPlugin(f: (plugin: ViewPluginValue) => void) {
    for (let plugin of this.behavior(viewPlugin)) {
      try { f(this.plugins[plugin.id]) }
      catch (e) {
        this.plugins[plugin.id] = {update() {}}
        console.error(e)
      }
    }
  }

  /// Update the view for the given array of transactions. This will
  /// update the visible document and selection to match the state
  /// produced by the transactions, and notify view plugins of the
  /// change.
  update(transactions: Transaction[] = [], metadata: Slot[] = []) {
    this.clearWaiting()
    let state = this.state, prevForeign = state.configuration.foreign
    for (let tr of transactions) {
      if (tr.startState != state)
        throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
      state = tr.apply()
    }
    let curForeign = state.configuration.foreign
    if (curForeign != prevForeign && (curForeign.length != prevForeign.length || curForeign.some((v, i) => v != prevForeign[i]))) {
      this.configure(curForeign)
      this.updatePlugins()
    }
    this.withUpdating(() => {
      let update = transactions.length > 0 || metadata.length > 0 ? new ViewUpdate(this, transactions, metadata) : null
      if (state.doc != this.state.doc || transactions.some(tr => tr.selectionSet && !tr.getMeta(Transaction.preserveGoalColumn)))
        this.inputState.goalColumns.length = 0
      this.docView.update(update, transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
      if (update) {
        this.inputState.ensureHandlers(this)
        this.drawPlugins()
        if (this.behavior(styleModule) != this.styleModules) this.mountStyles()
      }
      this.updateAttrs()
    })
  }

  /// Wait for the given promise to resolve, and then run an update.
  /// Or, if an update happens before that, set the promise's
  /// `canceled` property to true and ignore it.
  waitFor(promise: CancellablePromise<any>) {
    promise.then(() => {
      if (!promise.canceled) this.update([], [notified(true)])
    })
    this.waiting.push(promise)
  }

  private clearWaiting() {
    for (let promise of this.waiting) promise.canceled = true
    this.waiting.length = 0
  }

  /// @internal
  updateAttrs() {
    let editorAttrs = this.behavior(editorAttributes), contentAttrs = this.behavior(contentAttributes)
    updateAttrs(this.dom, this.editorAttrs, editorAttrs)
    this.editorAttrs = editorAttrs
    updateAttrs(this.contentDOM, this.contentAttrs, contentAttrs)
    this.contentAttrs = contentAttrs
  }

  private configure(fromState: readonly Extension[]) {
    this.configuration = extendView.resolve([defaultAttrs].concat(this.extensions).concat(fromState))
    if (this.configuration.foreign.length) throw new Error("Non-view extensions found in view")
  }

  private updatePlugins() {
    let old = this.plugins
    this.plugins = new IDMap
    for (let plugin of this.behavior(viewPlugin))
      this.plugins[plugin.id] = Object.prototype.hasOwnProperty.call(old, plugin.id) ? old[plugin.id] : plugin.create(this)
  }

  private mountStyles() {
    this.styleModules = this.behavior(styleModule)
    StyleModule.mount(this.root, this.styleModules.concat(styles).reverse())
  }

  /// @internal
  drawPlugins() {
    this.forEachPlugin(p => p.draw && p.draw())
    this.updateAttrs()
  }

  /// Get an instance of the given plugin class, or `undefined` if
  /// none exists in this view.
  plugin<T extends ViewPluginValue>(plugin: ViewPlugin<T>): T | undefined {
    return this.plugins[plugin.id]
  }

  /// Get the value of a view behavior.
  behavior<Output>(behavior: Behavior<any, Output>): Output {
    return this.configuration.getBehavior(behavior, this)
  }

  /// @internal
  updateInner(update: ViewUpdate, viewport: Viewport) {
    this.viewport = viewport
    this.state = update.state
    let oldPlugins = this.plugins
    this.plugins = new IDMap
    for (let plugin of this.behavior(viewPlugin)) {
      let value = this.plugins[plugin.id] = oldPlugins[plugin.id]
      value.update(update) // FIXME try/catch
    }
  }

  /// @internal
  withUpdating(f: () => void) {
    if (this.updating)
      throw new Error("Calls to EditorView.update are not allowed in plugin update or create methods")
    this.updating = true
    try { f() }
    finally { this.updating = false }
  }

  /// Query the active themes for the CSS class names associated with
  /// the given tag. (FIXME: this isn't a great system. Also doesn't
  /// invalidate when reconfiguring.)
  themeClass(tag: string): string {
    let result = ""
    for (let theme of this.behavior(themeClass)) {
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
    this.forEachPlugin(p => p.destroy && p.destroy())
    this.inputState.destroy()
    this.dom.remove()
    this.docView.destroy()
  }

  /// Behavior to add a [style
  /// module](https://github.com/marijnh/style-mod#readme) to an editor
  /// view. The view will ensure that the module is registered in its
  /// [document root](#view.EditorConfig.root).
  static styleModule = styleModule

  /// Behavior that can be used to add DOM event handlers. The value
  /// should be an object mapping event names to handler functions. The
  /// first such function to return true will be assumed to have handled
  /// that event, and no other handlers or built-in behavior will be
  /// activated for it.
  static handleDOMEvents = handleDOMEvents

  /// Behavior used to configure whether a given selection drag event
  /// should move or copy the selection. The given predicate will be
  /// called with the `mousedown` event, and can return `true` when
  /// the drag should move the content.
  static dragMovesSelection = dragMovesSelection

  /// Behavior used to configure whether a given selecting click adds
  /// a new range to the existing selection or replaces it entirely.
  static clickAddsSelectionRange = clickAddsSelectionRange

  /// A behavior that determines which [decorations](#view.Decoration)
  /// are shown in the view.
  static decorations = decorations

  /// Behavior that provides CSS classes to add to elements identified
  /// by the given string.
  static themeClass = themeClass

  /// Behavior that provides editor DOM attributes for the editor's
  /// outer element. FIXME move to EditorView?
  static contentAttributes = contentAttributes

  /// Behavior that provides attributes for the editor's editable DOM
  /// element.
  static editorAttributes = editorAttributes

  /// A slot that is used as a flag in view updates caused by changes to
  /// the view's focus state. Its value will be `true` when the view is
  /// being focused, `false` when it's losing focus.
  static focusChange = focusChange
}

const defaultAttrs: Extension = [
  extendView.dynamic(editorAttributes, view => ({
    class: "codemirror " + styles.wrapper + (view.hasFocus ? " codemirror-focused " : " ") + view.themeClass("editor.wrapper")
  })),
  extendView.dynamic(contentAttributes, view => ({
    spellcheck: "false",
    contenteditable: "true",
    class: styles.content + " codemirror-content " + view.themeClass("editor.content"),
    style: `${browser.tabSize}: ${view.state.tabSize}`
  }))
]
