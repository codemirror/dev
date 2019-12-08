import {EditorState, Transaction, CancellablePromise, Annotation, Extension} from "../../state"
import {StyleModule, Style} from "style-mod"

import {DocView} from "./docview"
import {InputState, MouseSelectionUpdate} from "./input"
import {Rect} from "./dom"
import {applyDOMChange} from "./domchange"
import {movePos, posAtCoords} from "./cursor"
import {BlockInfo} from "./heightmap"
import {Viewport} from "./viewport"
import {ViewUpdate, styleModule, theme, handleDOMEvents, focusChange,
        contentAttributes, editorAttributes, clickAddsSelectionRange, dragMovesSelection,
        viewPlugin, ViewPlugin, decorations, phrases, scrollMargins,
        notified} from "./extension"
import {Attrs, updateAttrs, combineAttrs} from "./attributes"
import {styles} from "./styles"
import browser from "./browser"

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
  private _state!: EditorState
  /// The current editor state.
  get state() { return this._state }

  /// @internal
  _viewport!: Viewport
  /// To be able to display large documents without consuming too much
  /// memory or overloading the browser, CodeMirror only draws the
  /// code that is visible, plus a margin around it, to the DOM. This
  /// property tells you the extent of the current drawn viewport, in
  /// document positions.
  get viewport(): {from: number, to: number} { return this._viewport }

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
  readonly docView: DocView

  /// @internal
  plugins: ViewPlugin<any>[] = []
  private editorAttrs: Attrs = {}
  private contentAttrs: Attrs = {}
  private styleModules!: readonly StyleModule[]
  private themeCache: {[cls: string]: string} = Object.create(null)
  private themeCacheFor: readonly StyleModule[] = []

  /// @internal
  updateState: UpdateState = UpdateState.Updating

  /// @internal
  waiting: CancellablePromise<any>[] = []

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

    this.docView = new DocView(this, (start, end, typeOver) => applyDOMChange(this, start, end, typeOver))

    let state = config.state || EditorState.create()
    this.docView.init(state, viewport => {
      this._viewport = viewport
      this._state = state
      this.plugins = this.state.facet(viewPlugin).map(create => create(this))
    })
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
  update(transactions: Transaction[] = [], annotations: Annotation<any>[] = []) {
    if (this.updateState != UpdateState.Idle)
      throw new Error("Calls to EditorView.update are not allowed while an update is in progress")
    this.updateState = UpdateState.Updating

    this.clearWaiting()
    let state = this.state
    for (let tr of transactions) {
      if (tr.startState != state)
        throw new RangeError("Trying to update state with a transaction that doesn't start from the current state.")
      state = tr.apply()
    }
    let update = transactions.length > 0 || annotations.length > 0 ? new ViewUpdate(this, transactions, annotations) : null
    if (state.doc != this.state.doc || transactions.some(tr => tr.selectionSet && !tr.annotation(Transaction.preserveGoalColumn)))
      this.inputState.goalColumns.length = 0
    this.docView.update(update, transactions.some(tr => tr.scrolledIntoView) ? state.selection.primary.head : -1)
    if (update) {
      this.inputState.ensureHandlers(this)
      if (this.state.facet(styleModule) != this.styleModules) this.mountStyles()
    }
    this.updateAttrs()
    this.updateState = UpdateState.Idle
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
    let editorAttrs = combineAttrs(this.state.facet(editorAttributes), {
      class: "codemirror " + styles.wrapper + (this.hasFocus ? " codemirror-focused " : " ") + this.cssClass("wrap")
    })
    updateAttrs(this.dom, this.editorAttrs, editorAttrs)
    this.editorAttrs = editorAttrs
    let contentAttrs = combineAttrs(this.state.facet(contentAttributes), {
      spellcheck: "false",
      contenteditable: "true",
      class: styles.content + " " + this.cssClass("content"),
      style: `${browser.tabSize}: ${this.state.tabSize}`
    })
    updateAttrs(this.contentDOM, this.contentAttrs, contentAttrs)
    this.contentAttrs = contentAttrs
    this.scrollDOM.className = this.cssClass("scroller") + " " + styles.scroller
  }

  private mountStyles() {
    this.styleModules = this.state.facet(styleModule)
    StyleModule.mount(this.root, this.styleModules.concat(styles).reverse())
  }

  /// @internal
  updateInner(update: ViewUpdate, viewport: Viewport) {
    this._viewport = viewport
    let prevSpecs = this.state.facet(viewPlugin), specs = update.state.facet(viewPlugin)
    this._state = update.state
    // FIXME try/catch and replace crashers with dummy plugins
    // FIXME get the DOM read/white ordering correct again
    if (prevSpecs != specs) {
      let newPlugins = [], reused = []
      for (let spec of specs) {
        let found = prevSpecs.indexOf(spec)
        if (found < 0) {
          newPlugins.push(spec(this))
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
      for (let plugin of this.plugins) if (plugin.update) plugin.update(update)
    }
  }

  /// Query the active themes for the CSS class names associated with
  /// the given name. Names can be single words or words separated by
  /// dot characters. In the latter case, the returned classes combine
  /// those that match the full name and those that match some
  /// prefix—for example `cssClass("panel.search")` will match both
  /// the theme styles specified as `"panel.search"` and those with
  /// just `"panel"`. More specific theme styles (with more dots) take
  /// precedence.
  cssClass(selector: string): string {
    let themes = this.state.facet(theme)
    if (themes != this.themeCacheFor) {
      this.themeCache = Object.create(null)
      this.themeCacheFor = themes
    } else {
      let known = this.themeCache[selector]
      if (known != null) return known
    }

    let result = ""
    for (let pos = 0;;) {
      let dot = selector.indexOf(".", pos)
      let cls = dot < 0 ? selector : selector.slice(0, dot)
      result += (result ? " " : "") + "codemirror-" + (pos ? cls.replace(/\./g, "-") : cls)
      for (let theme of themes) {
        let has = theme[cls]
        if (has) result += " " + has
      }
      if (dot < 0) break
      pos = dot + 1
    }
    return this.themeCache[selector] = result
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

  private readingLayout() {
    if (this.updateState == UpdateState.Updating)
      throw new Error("Reading the editor layout isn't allowed during an update")
    if (this.updateState == UpdateState.Idle && this.docView.layoutCheckScheduled > -1)
      this.docView.checkLayout()
  }

  /// Make sure plugins get a chance to measure the DOM before the
  /// next frame. Calling this is preferable to messing with the DOM
  /// directly from, for example, an even handler, because it'll make
  /// sure measuring and drawing done by other components is
  /// synchronized, avoiding unnecessary DOM layout computations.
  requireMeasure() {
    this.docView.scheduleLayoutCheck()
  }

  /// Find the line or block widget at the given vertical position.
  /// `editorTop`, if given, provides the vertical position of the top
  /// of the editor. It defaults to the editor's screen position
  /// (which will force a DOM layout).
  blockAtHeight(height: number, editorTop?: number) {
    this.readingLayout()
    return this.docView.blockAtHeight(height, editorTop)
  }

  /// Find information for the line at the given vertical position.
  /// The resulting block info might hold another array of block info
  /// structs in its `type` field if this line consists of more than
  /// one block.
  lineAtHeight(height: number, editorTop?: number): BlockInfo {
    this.readingLayout()
    return this.docView.lineAtHeight(height, editorTop)
  }

  /// Find the height information for the given line.
  lineAt(pos: number, editorTop?: number): BlockInfo {
    this.readingLayout()
    return this.docView.lineAt(pos, editorTop)
  }

  /// Iterate over the height information of the lines in the
  /// viewport.
  viewportLines(f: (height: BlockInfo) => void, editorTop?: number) {
    let {from, to} = this._viewport
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
  /// Returns -1 if no valid position could be found.
  posAtCoords(coords: {x: number, y: number}): number {
    this.readingLayout()
    return posAtCoords(this, coords)
  }

  /// Get the screen coordinates at the given document position.
  coordsAtPos(pos: number): Rect | null {
    this.readingLayout()
    return this.docView.coordsAt(pos)
  }

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
    this.docView.destroy()
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

  /// This facet can be used to indicate that, when scrolling
  /// something into view, certain parts at the side of the editor
  /// should be scrolled past (for example because there is a gutter
  /// or panel blocking them from view).
  static scrollMargins = scrollMargins

  /// Facet that provides attributes for the editor's editable DOM
  /// element.
  static contentAttributes = contentAttributes

  /// Facet that provides editor DOM attributes for the editor's
  /// outer element.
  static editorAttributes = editorAttributes

  /// An annotation that is used as a flag in view updates caused by
  /// changes to the view's focus state. Its value will be `true` when
  /// the view is being focused, `false` when it's losing focus.
  static focusChange = focusChange
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
    let docView = found[i].cmView
    if (docView) docView.editorView.update([], [notified(true)]) // FIXME remove need to pass an annotation?
  }
}
