import {EditorState, Transaction, Extension, Precedence, ChangeDesc, EditorSelection, SelectionRange} from "@codemirror/next/state"
import {Line} from "@codemirror/next/text"
import {StyleModule, Style} from "style-mod"

import {DocView} from "./docview"
import {ContentView} from "./contentview"
import {InputState} from "./input"
import {Rect, focusPreventScroll} from "./dom"
import {posAtCoords, moveByChar, moveToLineBoundary, byGroup, moveVertically} from "./cursor"
import {BlockInfo} from "./heightmap"
import {ViewState} from "./viewstate"
import {ViewUpdate, styleModule,
        contentAttributes, editorAttributes, clickAddsSelectionRange, dragMovesSelection, mouseSelectionStyle,
        exceptionSink, logException, viewPlugin, ViewPlugin, PluginInstance, PluginField,
        decorations, MeasureRequest, UpdateFlag, editable} from "./extension"
import {themeClass, theme, buildTheme, baseThemeID, baseTheme} from "./theme"
import {DOMObserver} from "./domobserver"
import {Attrs, updateAttrs, combineAttrs} from "./attributes"
import browser from "./browser"
import {applyDOMChange} from "./domchange"
import {computeOrder, trivialOrder, BidiSpan, Direction} from "./bidi"

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
  /// code that is visible (plus a margin around it) to the DOM. This
  /// property tells you the extent of the current drawn viewport, in
  /// document positions.
  get viewport(): {from: number, to: number} { return this.viewState.viewport }

  /// When there are, for example, large collapsed ranges in the
  /// viewport, its size can be a lot bigger than the actual visible
  /// content. Thus, if you are doing something like styling the
  /// content in the viewport, it is preferable to only do so for
  /// these ranges, which are the subset of the viewport that is
  /// actually drawn.
  get visibleRanges(): readonly {from: number, to: number}[] { return this.viewState.visibleRanges }
  
  /// All regular editor state updates should go through this. It
  /// takes a transaction, applies it, and updates the view to show
  /// the new state. Its implementation can be overridden with an
  /// [option](#view.EditorConfig.dispatch). Does not have to be
  /// called as a method.
  readonly dispatch: (tr: Transaction) => void

  /// The document or shadow root that the view lives in.
  readonly root: DocumentOrShadowRoot

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

  private plugins: PluginInstance[] = []
  private editorAttrs: Attrs = {}
  private contentAttrs: Attrs = {}
  private styleModules!: readonly StyleModule[]
  private bidiCache: CachedOrder[] = []

  /// @internal
  updateState: UpdateState = UpdateState.Updating

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
    this.scrollDOM.className = themeClass("scroller")
    this.scrollDOM.appendChild(this.contentDOM)

    this.dom = document.createElement("div")
    this.dom.appendChild(this.scrollDOM)

    this.dispatch = config.dispatch || ((tr: Transaction) => this.update([tr]))
    this.root = (config.root || document) as DocumentOrShadowRoot

    this.viewState = new ViewState(config.state || EditorState.create())
    this.plugins = this.state.facet(viewPlugin).map(spec => PluginInstance.create(spec, this))
    this.observer = new DOMObserver(this, (from, to, typeOver) => applyDOMChange(this, from, to, typeOver),
                                    () => this.measure())
    this.docView = new DocView(this)

    this.inputState = new InputState(this)
    this.mountStyles()
    this.updateAttrs()
    this.updateState = UpdateState.Idle

    ensureGlobalHandler()
    this.requestMeasure()
  }

  /// Update the view for the given array of transactions. This will
  /// update the visible document and selection to match the state
  /// produced by the transactions, and notify view plugins of the
  /// change.
  update(transactions: readonly Transaction[]) {
    if (this.updateState != UpdateState.Idle)
      throw new Error("Calls to EditorView.update are not allowed while an update is in progress")
    this.updateState = UpdateState.Updating

    let state = this.state
    for (let tr of transactions) {
      if (tr.startState != state)
        throw new RangeError("Trying to update state with a transaction that doesn't start from the previous state.")
      state = tr.state
    }
    let update = new ViewUpdate(this, state, transactions)
    let scrollTo = transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary : null
    this.viewState.update(update, scrollTo)
    this.bidiCache = CachedOrder.update(this.bidiCache, update.changes)
    if (!update.empty) this.updatePlugins(update)
    let redrawn = this.docView.update(update)
    if (this.state.facet(styleModule) != this.styleModules) this.mountStyles()
    this.updateAttrs()
    this.updateState = UpdateState.Idle
    if (redrawn || scrollTo || this.viewState.mustEnforceCursorAssoc) this.requestMeasure()
  }

  updatePlugins(update: ViewUpdate) {
    let prevSpecs = update.prevState.facet(viewPlugin), specs = update.state.facet(viewPlugin)
    if (prevSpecs != specs) {
      let newPlugins = [], reused = []
      for (let spec of specs) {
        let found = prevSpecs.indexOf(spec)
        if (found < 0) {
          newPlugins.push(PluginInstance.create(spec, this))
        } else {
          let plugin = this.plugins[found].update(update)
          reused.push(plugin)
          newPlugins.push(plugin)
        }
      }
      for (let plugin of this.plugins)
        if (reused.indexOf(plugin) < 0) plugin.destroy(this)
      this.plugins = newPlugins
      this.inputState.ensureHandlers(this)
    } else {
      for (let i = 0; i < this.plugins.length; i++)
        this.plugins[i] = this.plugins[i].update(update)
    }
  }

  /// @internal
  measure() {
    if (this.measureScheduled > -1) cancelAnimationFrame(this.measureScheduled)
    this.measureScheduled = 1 // Prevent requestMeasure calls from scheduling another animation frame

    for (let i = 0;; i++) {
      this.updateState = UpdateState.Measuring
      let changed = this.viewState.measure(this.docView, i > 0)
      let measuring = this.measureRequests
      if (!changed && !measuring.length && this.viewState.scrollTo == null) break
      this.measureRequests = []
      if (i > 5) {
        console.warn("Viewport failed to stabilize")
        break
      }
      let measured = measuring.map(m => {
        try { return m.read(this) }
        catch(e) { logException(this.state, e); return BadMeasure }
      })
      let update = new ViewUpdate(this, this.state)
      update.flags |= changed
      this.updateState = UpdateState.Updating
      this.updatePlugins(update)
      if (changed) this.docView.update(update)
      for (let i = 0; i < measuring.length; i++) if (measured[i] != BadMeasure) {
        try { measuring[i].write(measured[i], this) }
        catch(e) { logException(this.state, e) }
      }
      if (this.viewState.scrollTo) {
        this.docView.scrollPosIntoView(this.viewState.scrollTo.head, this.viewState.scrollTo.assoc)
        this.viewState.scrollTo = null
      }
      if (!(changed & UpdateFlag.Viewport) && this.measureRequests.length == 0) break
    }

    this.updateState = UpdateState.Idle
    this.measureScheduled = -1
  }

  private updateAttrs() {
    let editorAttrs = combineAttrs(this.state.facet(editorAttributes), {
      class: themeClass("wrap") + (this.hasFocus ? " cm-focused " : " ") +
        baseThemeID + " " + this.state.facet(theme).join(" ")
    })
    updateAttrs(this.dom, this.editorAttrs, editorAttrs)
    this.editorAttrs = editorAttrs
    let contentAttrs = combineAttrs(this.state.facet(contentAttributes), {
      spellcheck: "false",
      contenteditable: String(this.state.facet(editable)),
      class: themeClass("content"),
      style: `${browser.tabSize}: ${this.state.tabSize}`,
      role: "textbox",
      "aria-multiline": "true"
    })
    updateAttrs(this.contentDOM, this.contentAttrs, contentAttrs)
    this.contentAttrs = contentAttrs
  }

  private mountStyles() {
    this.styleModules = this.state.facet(styleModule)
    StyleModule.mount(this.root, this.styleModules.concat(baseTheme).reverse())
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

  /// Collect all values provided by the active plugins for a given
  /// field.
  pluginField<T>(field: PluginField<T>): readonly T[] {
    // FIXME make this error when called during plugin updating
    let result: T[] = []
    for (let plugin of this.plugins) plugin.takeField(field, result)
    return result
  }

  /// Get the value of a specific plugin, if present. Note that
  /// plugins that crash can be dropped from a view, so even when you
  /// know you registered a given plugin, it is recommended to check
  /// the return value of this method.
  plugin<T>(plugin: ViewPlugin<T>): T | null {
    for (let inst of this.plugins) if (inst.spec == plugin) return inst.value as T
    return null
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
    // FIXME separate line (extent, bidi, widgets) info from height queries
    if (editorTop == null) this.readMeasured()
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

  /// Move a cursor position by [grapheme
  /// cluster](#text.nextClusterBoundary). `forward` determines
  /// whether the motion is away from the line start, or towards it.
  /// Motion in bidirectional text is in visual order, in the editor's
  /// [text direction](#view.EditorView.textDirection). When the start
  /// position was the last one on the line, the returned position
  /// will be across the line break. If there is no further line, the
  /// original position is returned.
  moveByChar(start: SelectionRange, forward: boolean, by?: (initial: string) => (next: string) => boolean) {
    return moveByChar(this, start, forward, by)
  }

  /// Move a cursor position across the next group of either
  /// [letters](#state.EditorState.charCategorizer) or non-letter
  /// non-whitespace characters.
  moveByGroup(start: SelectionRange, forward: boolean) {
    return moveByChar(this, start, forward, initial => byGroup(this, start.head, initial))
  }

  /// Move to the next line boundary in the given direction. If
  /// `includeWrap` is true, line wrapping is on, and there is a
  /// further wrap point on the current line, the wrap point will be
  /// returned. Otherwise this function will return the start or end
  /// of the line.
  moveToLineBoundary(start: SelectionRange, forward: boolean, includeWrap = true) {
    return moveToLineBoundary(this, start, forward, includeWrap)
  }

  /// Move a cursor position vertically. When `distance` isn't given,
  /// it defaults to moving to the next line (including wrapped
  /// lines). Otherwise, `distance` should provide a positive distance
  /// in pixels.
  ///
  /// When `start` has a
  /// [`goalColumn`](#state.SelectionRange.goalColumn), the vertical
  /// motion will use that as a target horizontal position. Otherwise,
  /// the cursor's own horizontal position is used. The returned
  /// cursor will have its goal column set to whichever column was
  /// used.
  moveVertically(start: SelectionRange, forward: boolean, distance?: number) {
    return moveVertically(this, start, forward, distance)
  }

  /// Scroll the given document position into view.
  scrollPosIntoView(pos: number) {
    this.viewState.scrollTo = EditorSelection.cursor(pos)
    this.requestMeasure()
  }

  /// Get the document position at the given screen coordinates.
  /// Returns -1 if no valid position could be found.
  posAtCoords(coords: {x: number, y: number}): number {
    this.readMeasured()
    return posAtCoords(this, coords)
  }

  /// Get the screen coordinates at the given document position.
  coordsAtPos(pos: number, side: -1 | 1 = 1): Rect | null {
    this.readMeasured()
    let rect = this.docView.coordsAt(pos, side)
    if (!rect || rect.left == rect.right) return rect
    let line = this.state.doc.lineAt(pos), order = this.bidiSpans(line)
    let span = order[BidiSpan.find(order, pos - line.start, -1, side)]
    let x = (span.dir == Direction.LTR) == (side < 0) ? rect.right : rect.left
    return {left: x, right: x, top: rect.top, bottom: rect.bottom}
  }

  /// The default width of a character in the editor. May not
  /// accurately reflect the width of all characters.
  get defaultCharacterWidth() { return this.viewState.heightOracle.charWidth }
  /// The default height of a line in the editor.
  get defaultLineHeight() { return this.viewState.heightOracle.lineHeight }
  /// The text direction (`direction` CSS property) of the editor.
  get textDirection(): Direction { return this.viewState.heightOracle.direction }
  /// Whether this editor [wraps lines](#view.EditorView.lineWrapping)
  /// (as determined by the `white-space` CSS property of its content
  /// element).
  get lineWrapping(): boolean { return this.viewState.heightOracle.lineWrapping }

  /// Returns the bidirectional text structure of the given line
  /// (which should be in the current document) as an array of span
  /// objects. The order of these spans matches the [text
  /// direction](#view.EditorView.textDirection)—if that is
  /// left-to-right, the leftmost spans come first, otherwise the
  /// rightmost spans come first.
  bidiSpans(line: Line) {
    if (line.length > MaxBidiLine) return trivialOrder(line.length)
    let dir = this.textDirection
    for (let entry of this.bidiCache) if (entry.from == line.start && entry.dir == dir) return entry.order
    let order = computeOrder(line.slice(), this.textDirection)
    this.bidiCache.push(new CachedOrder(line.start, line.end, dir, order))
    return order
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
    for (let plugin of this.plugins) plugin.destroy(this)
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
  static domEventHandlers(handlers: {[Type in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[Type], view: EditorView) => boolean}): Extension {
    return ViewPlugin.define(() => ({})).eventHandlers(handlers)
  }

  /// Allows you to provide a function that should be called when the
  /// library catches an exception from an extension (mostly from view
  /// plugins, but may be used by other extensions to route exceptions
  /// from user-code-provided callbacks). This is mostly useful for
  /// debugging and logging. See [`logException`](#view.logException).
  static exceptionSink = exceptionSink

  /// Facet that controls whether the editor content is editable. When
  /// its the highest-precedence value is `false`, editing is
  /// disabled, and the content element will no longer have its
  /// `contenteditable` attribute set to `true`. (Note that this
  /// doesn't affect API calls that change the editor content, even
  /// when those are bound to keys or buttons.)
  static editable = editable

  /// Facet used to configure whether a given selection drag event
  /// should move or copy the selection. The given predicate will be
  /// called with the `mousedown` event, and can return `true` when
  /// the drag should move the content.
  static dragMovesSelection = dragMovesSelection

  /// Facet used to configure whether a given selecting click adds
  /// a new range to the existing selection or replaces it entirely.
  static clickAddsSelectionRange = clickAddsSelectionRange

  /// Allows you to influence the way mouse selection happens. The
  /// functions in this facet will be called for a `mousedown` event
  /// on the editor, and can return an object that overrides the way a
  /// selection is computed from that mouse click or drag.
  static mouseSelectionStyle = mouseSelectionStyle

  /// A facet that determines which [decorations](#view.Decoration)
  /// are shown in the view. See also [view
  /// plugins](#view.EditorView^decorations), which have a separate
  /// mechanism for providing decorations.
  static decorations = decorations

  /// Create a theme extension. The argument object should map [theme
  /// selectors](#view.themeClass) to styles, which are (potentially
  /// nested) [style
  /// declarations](https://github.com/marijnh/style-mod#documentation)
  /// providing the CSS styling for the selector.
  static theme(spec: {[name: string]: Style}): Extension {
    let prefix = StyleModule.newName()
    return [theme.of(prefix), styleModule.of(buildTheme(prefix, spec))]
  }

  /// Create an extension that adds styles to the base theme.
  static baseTheme(spec: {[name: string]: Style}): Extension {
    return Precedence.Fallback.set(styleModule.of(buildTheme(baseThemeID, spec)))
  }

  /// An extension that enables line wrapping in the editor.
  static lineWrapping = EditorView.theme({content: {whiteSpace: "pre-wrap"}})

  /// Facet that provides attributes for the editor's editable DOM
  /// element.
  static contentAttributes = contentAttributes

  /// Facet that provides editor DOM attributes for the editor's
  /// outer element.
  static editorAttributes = editorAttributes
}

// Maximum line length for which we compute accurate bidi info
const MaxBidiLine = 4096

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
  let found = document.querySelectorAll(".cm-content")
  for (let i = 0; i < found.length; i++) {
    let docView = ContentView.get(found[i])
    if (docView) docView.editorView.requestMeasure()
  }
}

const BadMeasure = {}

class CachedOrder {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly dir: Direction,
    readonly order: readonly BidiSpan[]
  ) {}

  static update(cache: CachedOrder[], changes: ChangeDesc) {
    if (changes.empty) return cache
    let result = [], lastDir = cache.length ? cache[cache.length - 1].dir : Direction.LTR
    for (let i = Math.max(0, cache.length - 10); i < cache.length; i++) {
      let entry = cache[i]
      if (entry.dir == lastDir && !changes.touchesRange(entry.from, entry.to))
        result.push(new CachedOrder(changes.mapPos(entry.from, 1), changes.mapPos(entry.to, -1), entry.dir, entry.order))
    }
    return result
  }
}
