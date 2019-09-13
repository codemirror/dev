import {EditorState, Transaction, ChangeSet} from "../../state/src"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet, Decoration} from "./decoration"
import {Extension, ExtensionType, Slot, SlotType} from "../../extension/src/extension"
import {EditorView} from "./editorview"
import {Attrs} from "./attributes"

const none: readonly any[] = []

export const extendView = new ExtensionType

/// Behavior that can be used to add DOM event handlers. The value
/// should be an object mapping event names to handler functions. The
/// first such function to return true will be assumed to have handled
/// that event, and no other handlers or built-in behavior will be
/// activated for it.
export const handleDOMEvents = extendView.behavior<{[key: string]: (view: EditorView, event: any) => boolean}>()

/// Behavior used to configure whether a given selecting click adds a
/// new range to the existing selection or replaces it entirely.
export const clickAddsSelectionRange = extendView.behavior<(event: MouseEvent) => boolean>()

/// Behavior used to configure whether a given selection drag event
/// should move or copy the selection. The given predicate will be
/// called with the `mousedown` event, and can return `true` when the
/// drag should move the content.
export const dragMovesSelection = extendView.behavior<(event: MouseEvent) => boolean>()

// FIXME this should work differently
/// Behavior that provides CSS classes to add to elements identified
/// by the given string.
export const themeClass = extendView.behavior<(tag: string) => string>()

/// View plugins are stateful objects that are associated with a view.
/// They are notified when the view is updated or destroyed. In
/// contrast to view fields, view plugins are told about updates
/// _after_ the view has updated itself. They cannot influence the way
/// the content of the view is drawn, but are useful for things like
/// drawing UI elements outside of that content (such as a gutter or
/// tooltip).
export class ViewPlugin<T = undefined> {
  // FIXME document
  update(update: ViewUpdate) {}

  draw() {}

  measure(): T { return undefined as any as T }
  drawMeasured(measurement: T) {}

  destroy() {}

  decorations!: DecorationSet
  editorAttributes!: Attrs | undefined
  contentAttributes!: Attrs | undefined

  static extension(this: {new (view: EditorView): ViewPlugin<any>}): Extension
  static extension<T>(this: {new (view: EditorView, config: T): ViewPlugin<any>}, config: T): Extension
  static extension<T>(config?: T) { return viewPlugin({constructor: this, config}) }

  /// Create a view plugin extension that only computes decorations.
  /// When `map` is true, the set passed to `update` will already have
  /// been mapped through the transactions in the `ViewUpdate`.
  static decorate(spec: {
    create: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    return DecorationPlugin.extension(spec)
  }

  static attributes(editor?: Attrs, content?: Attrs) {
    return AttributePlugin.extension({editor, content})
  }
}

ViewPlugin.prototype.decorations = Decoration.none
ViewPlugin.prototype.editorAttributes = undefined
ViewPlugin.prototype.contentAttributes = undefined

// Registers view plugins.
export const viewPlugin = extendView.behavior<{constructor: {new (view: EditorView, config: any): ViewPlugin}, config: any}>()

class DecorationPlugin extends ViewPlugin {
  constructor(view: EditorView, readonly spec: {
    create: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    super()
    this.decorations = spec.create(view)
  }
  update(update: ViewUpdate) {
    this.decorations = this.spec.update(this.spec.map ? this.decorations.map(update.changes) : this.decorations, update)
  }
}

class AttributePlugin extends ViewPlugin {
  constructor(view: EditorView, {editor, content}: {editor: Attrs | undefined, content: Attrs | undefined}) {
    super()
    this.editorAttributes = editor
    this.contentAttributes = content
  }
}

/// Extension to add a [style
/// module](https://github.com/marijnh/style-mod#readme) to an editor
/// view. The view will ensure that the module is registered in its
/// [document root](#view.EditorConfig.root).
export const styleModule = extendView.behavior<StyleModule>()

/// A slot that is used as a flag in view updates caused by changes to
/// the view's focus state. Its value will be `true` when the view is
/// being focused, `false` when it's losing focus.
export const focusChange = Slot.define<boolean>()

export const notified = Slot.define<boolean>()

/// View [fields](#view.ViewField) and [plugins](#view.ViewPlugin) are
/// given instances of this class, which describe what happened,
/// whenever the view is updated.
export class ViewUpdate {
  /// The new editor state.
  readonly state: EditorState
  /// The changes made to the document by this update.
  readonly changes: ChangeSet
  /// The previous editor state.
  readonly prevState: EditorState
  /// The previous viewport range.
  readonly prevViewport: Viewport

  /// @internal
  constructor(
    /// The editor view that the update is associated with.
    readonly view: EditorView,
    /// The transactions involved in the update. May be empty.
    readonly transactions: ReadonlyArray<Transaction> = none,
    // @internal
    readonly metadata: ReadonlyArray<Slot> = none
  ) {
    this.state = transactions.length ? transactions[transactions.length - 1].apply() : view.state
    this.changes = transactions.reduce((chs, tr) => chs.appendSet(tr.changes), ChangeSet.empty)
    this.prevState = view.state
    this.prevViewport = view.viewport
  }

  /// The new viewport range.
  get viewport() { return this.view.viewport }

  /// Tells you whether the viewport changed in this update.
  get viewportChanged() {
    return !this.prevViewport.eq(this.view.viewport)
  }

  /// Whether the document changed in this update.
  get docChanged() {
    return this.transactions.some(tr => tr.docChanged)
  }

  /// Get the value of the given slot, if it was passed as a flag for
  /// the update or present in any of the transactions involved in the
  /// update.
  getMeta<T>(type: SlotType<T>): T | undefined {
    for (let i = this.transactions.length; i >= 0; i--) {
      let found = i == this.transactions.length ? Slot.get(type, this.metadata) : this.transactions[i].getMeta(type)
      if (found !== undefined) return found
    }
    return undefined
  }
}
