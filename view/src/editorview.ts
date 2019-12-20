import {EditorState, Transaction, CancellablePromise, Extension} from "../../state"
import {StyleModule, Style} from "style-mod"

import {DocView} from "./docview"
import {ContentView} from "./contentview"
import {InputState, MouseSelectionUpdate} from "./input"
import {Rect, focusPreventScroll} from "./dom"
import {movePos, posAtCoords} from "./cursor"
import {BlockInfo} from "./heightmap"
import {ViewState} from "./viewport"
import {ViewUpdate, styleModule, theme, handleDOMEvents,
        contentAttributes, editorAttributes, clickAddsSelectionRange, dragMovesSelection,
        viewPlugin, ViewPlugin, decorations, phrases, MeasureRequest} from "./extension"
import {DOMObserver} from "./domobserver"
import {Attrs, updateAttrs, combineAttrs} from "./attributes"
import {styles} from "./styles"
import {themeClass} from "./theme"
import browser from "./browser"
import {applyDOMChange} from "./domchange"

/// Configuration parameters passed when creating an editor view.
export interface EditorConfig {
  /// The view's initial state. Defaults to an extension-less state
  /// with an empty document.
  state?: EditorState,
  /// If the view is going to be mounted in a shadow root or document
  /// other than the one held by the global variable `document` (the
  /// default), you should pass it here.
  root?: Document | ShadowRoot,
  /// Override the transaction dispatch function for this editor view.
  /// Your implementation, if provided, should probably call the
  /// view's [`update` method](#view.EditorView.update).
  dispatch?: (tr: Transaction) => void
}

export const enum UpdateState {
  Idle, // Not updating
  Measuring, // In the layout-reading phase of a layout check
  Updating // Updating/drawing, either directly via the `update` method, or as a result of a layout check
}

// The editor's update state machine looks something like this:
//
//     Idle → Updating ⇆ Idle (unchecked) → Measuring → Idle
//                                         ↑      ↓
//                                         Updating (measure)
//
// The difference between 'Idle' and 'Idle (unchecked)' lies in
// whether a layout check has been scheduled. A regular update through
// the `update` method updates the DOM in a write-only fashion, and
// relies on a check (scheduled with `requestAnimationFrame`) to make
// sure everything is where it should be and the viewport covers the
// visible code. That check continues to measure and then optionally
// update until it reaches a coherent state.

/// An editor view represents the editor's user interface. It holds
/// the editable DOM surface, and possibly other elements such as the
/// line number gutter. It handles events and dispatches state
/// transactions for editing actions.
export class EditorView {
  /// The current editor state.
  get state() { return this.viewState.state }

  /// To be able to display large documents without consuming too much
  /// memory or overloading the browser, CodeMirror only draws the
  /// code that is visible, plus a margin around it, to the DOM. This
  /// property tells you the extent of the current drawn viewport, in
  /// document positions.
  get viewport(): {from: number, to: number} { return this.viewState.viewport }

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
  readonly root: DocumentOrShadowRoot // FIXME provide portable local getSelection

  /// The DOM element that wraps the entire editor view.
  readonly dom: HTMLElement

  /// The DOM element that can be made to scroll.
  readonly scrollDOM: HTMLElement

  /// The editable DOM element holding the editor content. You should
  /// not, usually, interact with this content directly, though the
  /// DOM, since the editor will immediately undo most of the changes
  /// you make. Instead, use transactions to modify content, and
  /// [decorations](#view.Decoration) to style it.
  readonly contentDOM: HTMLElement

  /// @internal
  inputState!: InputState

  /// @internal
  readonly viewState: ViewState
  /// @internal
  readonly docView: DocView

  /// @internal
  plugins: ViewPlugin[] = []
  private editorAttrs: Attrs = {}
  private contentAttrs: Attrs = {}
  private styleModules!: readonly StyleModule[]

  /// @internal
  updateState: UpdateState = UpdateState.Updating

  /// @internal
  waiting: CancellablePromise<any>[] = []

  /// @internal
  observer: DOMObserver

  /// @internal
  measureScheduled: number = -1
  /// @internal
  measureRequests: MeasureRequest<any>[] = []

  /// Construct a new view. You'll usually want to put `view.dom` into
  /// your document after creating a view, so that the user can see
  /// it.
  constructor(config: EditorConfig = {}) {
    this.contentDOM = document.createElement("div")

    this.scrollDOM = document.createElement("div")
    this.scrollDOM.appendChild(this.contentDOM)

    this.dom = document.createElement("div")
    this.dom.appendChild(this.scrollDOM)

    this.dispatch = config.dispatch || ((tr: Transaction) => this.update([tr]))
    this.root = (config.root || document) as DocumentOrShadowRoot

    this.viewState = new ViewState(config.state || EditorState.create())
    this.plugins = this.state.facet(viewPlugin).map(ctor => ctor(this))
    this.observer = new DOMObserver(this, (from, to, typeOver) => applyDOMChange(this, from, to, typeOver),
                                    () => this.measure())
    this.docView = new DocView(this)

    this.inputState = new InputState(this)
    this.mountStyles()
    this.updateAttrs()
    this.updateState = UpdateState.Idle

    ensureGlobalHandler()
  }

  /// Update the view for the given array of transactions. This will
  /// update the visible document and selection to match the state
  /// produced by the transactions, and notify view plugins of the
  /// change.
  update(transactions: Transaction[]) {
    if (this.updateState != UpdateState.Idle)
      throw new Error("Calls to EditorView.update are not allowed while an update is in progress")
    this.updateState = UpdateState.Updating // FIXME make sure this is maintained correctly

    this.clearWaiting()
    let state = this.state
    for (let tr of transactions) {
      if (tr.startState != state)
        throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
      state = tr.apply()
    }
    let update = new ViewUpdate(this, state, transactions)
    if (state.doc != this.state.doc || transactions.some(tr => tr.selectionSet && !tr.annotation(Transaction.preserveGoalColumn)))
      this.inputState.goalColumns.length = 0

    let ranges = this.viewState.update(update, transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
    if (!update.empty) this.updatePlugins(update)
    this.docView.update(update, ranges)
    this.inputState.ensureHandlers(this)
    if (this.state.facet(styleModule) != this.styleModules) this.mountStyles()
    this.updateAttrs()
    this.updateState = UpdateState.Idle
    if (update.docChanged) this.requestMeasure()
  }

  updatePlugins(update: ViewUpdate) {
    let prevSpecs = update.prevState.facet(viewPlugin), specs = update.state.facet(viewPlugin)
    // FIXME try/catch and replace crashers with dummy plugins
    if (prevSpecs != specs) {
      let newPlugins = [], reused = []
      for (let ctor of specs) {
        let found = prevSpecs.indexOf(ctor)
        if (found < 0) {
          newPlugins.push(ctor(this))
        } else {
          let plugin = this.plugins[found]
          reused.push(plugin)
          if (plugin.update) plugin.update(update)
          newPlugins.push(plugin)
        }
      }
      for (let plugin of this.plugins)
        if (plugin.destroy && reused.indexOf(plugin) < 0) plugin.destroy()
      this.plugins = newPlugins
    } else {
      for (let plugin of this.plugins) plugin.update(update)
    }
  }

  measure() {
    if (this.measureScheduled > -1) cancelAnimationFrame(this.measureScheduled)
    this.measureScheduled = 1 // Prevent requestMeasure calls from scheduling another animation frame

    for (let i = 0;; i++) {
      this.updateState = UpdateState.Measuring
      let changed = this.viewState.measure(this.docView, i > 0)
      let measuring = this.measureRequests
      if (!changed && !measuring.length) break
      this.measureRequests = []
      if (i > 5) {
        console.warn("Viewport failed to stabilize")
        break
      }
      let measured = measuring.map(m => m.read(this))
      let update = new ViewUpdate(this, this.state)
      update.flags |= changed
      this.updateState = UpdateState.Updating
      this.updatePlugins(update)
      if (changed) this.docView.update(update, [])
      for (let i = 0; i < measuring.length; i++) measuring[i].write(measured[i], this)

      if (!changed && this.measureRequests.length == 0) break
    }

    this.updateState = UpdateState.Idle
    this.measureScheduled = -1
  }

  /// Wait for the given promise to resolve, and then run an update.
  /// Or, if an update happens before that, set the promise's
  /// `canceled` property to true and ignore it.
  waitFor(promise: CancellablePromise<any>) {
    promise.then(() => {
      if (!promise.canceled) this.update([])
    })
    this.waiting.push(promise)
  }

  private clearWaiting() {
    for (let promise of this.waiting) promise.canceled = true
    this.waiting.length = 0
  }

  /// @internal
  updateAttrs() {
    let editorAttrs = combineAttrs(this.state.facet(editorAttributes), {
      class: "codemirror " + styles.wrapper + (this.hasFocus ? " codemirror-focused " : " ") + themeClass(this.state, "wrap")
    })
    updateAttrs(this.dom, this.editorAttrs, editorAttrs)
    this.editorAttrs = editorAttrs
    let contentAttrs = combineAttrs(this.state.facet(contentAttributes), {
      spellcheck: "false",
      contenteditable: "true",
      class: styles.content + " " + themeClass(this.state, "content"),
      style: `${browser.tabSize}: ${this.state.tabSize}`
    })
    updateAttrs(this.contentDOM, this.contentAttrs, contentAttrs)
    this.contentAttrs = contentAttrs
    this.scrollDOM.className = themeClass(this.state, "scroller") + " " + styles.scroller
  }

  private mountStyles() {
    this.styleModules = this.state.facet(styleModule)
    StyleModule.mount(this.root, this.styleModules.concat(styles).reverse())
  }

  /// Look up a translation for the given phrase (via the
  /// [`phrases`](#view.EditorView^phrases) facet), or return the
  /// original string if no translation is found.
  phrase(phrase: string): string {
    for (let map of this.state.facet(phrases)) {
      if (Object.prototype.hasOwnProperty.call(map, phrase)) return map[phrase]
    }
    return phrase
  }

  /// Find the DOM parent node and offset (child offset if `node` is
  /// an element, character offset when it is a text node) at the
  /// given document position.
  domAtPos(pos: number): {node: Node, offset: number} {
    return this.docView.domAtPos(pos)
  }

  /// Find the document position at the given DOM node. Can be useful
  /// for associating positions with DOM events. Will raise an error
  /// when `node` isn't part of the editor content.
  posAtDOM(node: Node, offset: number = 0) {
    return this.docView.posFromDOM(node, offset)
  }

  private readMeasured() {
    if (this.updateState == UpdateState.Updating)
      throw new Error("Reading the editor layout isn't allowed during an update")
    if (this.updateState == UpdateState.Idle && this.measureScheduled > -1) this.measure()
  }

  /// Make sure plugins get a chance to measure the DOM before the
  /// next frame. Calling this is preferable to messing with the DOM
  /// directly from, for example, an even handler, because it'll make
  /// sure measuring and drawing done by other components is
  /// synchronized, avoiding unnecessary DOM layout computations.
  requestMeasure<T>(request?: MeasureRequest<T>) {
    if (this.measureScheduled < 0)
      this.measureScheduled = requestAnimationFrame(() => this.measure())
    if (request) {
      if (request.key != null) for (let i = 0; i < this.measureRequests.length; i++) {
        if (this.measureRequests[i].key === request.key) {
          this.measureRequests[i] = request
          return
        }
      }
      this.measureRequests.push(request)
    }
  }

  /// Find the line or block widget at the given vertical position.
  /// `editorTop`, if given, provides the vertical position of the top
  /// of the editor. It defaults to the editor's screen position
  /// (which will force a DOM layout).
  blockAtHeight(height: number, editorTop?: number) {
    this.readMeasured()
    return this.viewState.blockAtHeight(height, ensureTop(editorTop, this.contentDOM))
  }

  /// Find information for the line at the given vertical position.
  /// The resulting block info might hold another array of block info
  /// structs in its `type` field if this line consists of more than
  /// one block.
  lineAtHeight(height: number, editorTop?: number): BlockInfo {
    this.readMeasured()
    return this.viewState.lineAtHeight(height, ensureTop(editorTop, this.contentDOM))
  }

  /// Find the height information for the given line.
  lineAt(pos: number, editorTop?: number): BlockInfo {
    this.readMeasured()
    return this.viewState.lineAt(pos, ensureTop(editorTop, this.contentDOM))
  }

  /// Iterate over the height information of the lines in the
  /// viewport.
  viewportLines(f: (height: BlockInfo) => void, editorTop?: number) {
    let {from, to} = this.viewport
    this.viewState.forEachLine(from, to, f, ensureTop(editorTop, this.contentDOM))
  }

  /// The editor's total content height.
  get contentHeight() {
    return this.viewState.heightMap.height + this.viewState.paddingTop + this.viewState.paddingBottom
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
  /// Returns -1 if no valid position could be found.
  posAtCoords(coords: {x: number, y: number}): number {
    this.readMeasured()
    return posAtCoords(this, coords)
  }

  /// Get the screen coordinates at the given document position.
  coordsAtPos(pos: number): Rect | null {
    this.readMeasured()
    return this.docView.coordsAt(pos)
  }

  /// The default width of a character in the editor. May not
  /// accurately reflect the width of all characters.
  get defaultCharacterWidth() { return this.viewState.heightOracle.charWidth }
  /// The default height of a line in the editor.
  get defaultLineHeight() { return this.viewState.heightOracle.lineHeight }

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
    this.observer.ignore(() => {
      focusPreventScroll(this.contentDOM)
      this.docView.updateSelection()
    })
  }

  /// Clean up this editor view, removing its element from the
  /// document, unregistering event handlers, and notifying
  /// plugins. The view instance can no longer be used after
  /// calling this.
  destroy() {
    for (let plugin of this.plugins) {
      if (plugin.destroy) {
        try { plugin.destroy() }
        catch(e) { console.error(e) }
      }
    }
    this.inputState.destroy()
    this.dom.remove()
    this.observer.destroy()
    if (this.measureScheduled > -1) cancelAnimationFrame(this.measureScheduled)
  }

  /// Facet to add a [style
  /// module](https://github.com/marijnh/style-mod#readme) to an editor
  /// view. The view will ensure that the module is registered in its
  /// [document root](#view.EditorConfig.root).
  static styleModule = styleModule

  /// Facet that can be used to add DOM event handlers. The value
  /// should be an object mapping event names to handler functions. The
  /// first such function to return true will be assumed to have handled
  /// that event, and no other handlers or built-in behavior will be
  /// activated for it.
  static handleDOMEvents = handleDOMEvents

  /// Facet used to configure whether a given selection drag event
  /// should move or copy the selection. The given predicate will be
  /// called with the `mousedown` event, and can return `true` when
  /// the drag should move the content.
  static dragMovesSelection = dragMovesSelection

  /// Facet used to configure whether a given selecting click adds
  /// a new range to the existing selection or replaces it entirely.
  static clickAddsSelectionRange = clickAddsSelectionRange

  /// A facet that determines which [decorations](#view.Decoration)
  /// are shown in the view.
  static decorations = decorations

  
  static viewPlugin = viewPlugin

  /// Facet that provides CSS classes to add to elements identified
  /// by the given string.
  static theme(spec: {[name: string]: Style}): Extension {
    for (let prop in spec) {
      let specificity = prop.split(".").length - 1
      if (specificity > 0) spec[prop].specificity = specificity
    }
    let module = new StyleModule(spec)
    return [theme.of(module), styleModule.of(module)]
  }

  /// Registers translation phrases. The
  /// [`phrase`](#view.EditorView.phrase) method will look through all
  /// objects registered with this facet to find translations for
  /// its argument.
  static phrases = phrases

  /// Facet that provides attributes for the editor's editable DOM
  /// element.
  static contentAttributes = contentAttributes

  /// Facet that provides editor DOM attributes for the editor's
  /// outer element.
  static editorAttributes = editorAttributes
}

function ensureTop(given: number | undefined, dom: HTMLElement) {
  return given == null ? dom.getBoundingClientRect().top : given
}

let registeredGlobalHandler = false, resizeDebounce = -1

function ensureGlobalHandler() {
  if (registeredGlobalHandler) return
  window.addEventListener("resize", () => {
    if (resizeDebounce == -1) resizeDebounce = setTimeout(handleResize, 50)
  })
}

function handleResize() {
  resizeDebounce = -1
  let found = document.querySelectorAll(".codemirror-content")
  for (let i = 0; i < found.length; i++) {
    let docView = ContentView.get(found[i])
    if (docView) docView.editorView.requestMeasure() // FIXME remove need to pass an annotation?
  }
}
