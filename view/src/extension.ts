import {EditorState, Transaction, ChangeSet} from "../../state/src"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet} from "./decoration"
import {Extension, ExtensionType, Behavior, Values, Slot, SlotType} from "../../extension/src/extension"
import {EditorView} from "./editorview"
import {Attrs, combineAttrs} from "./attributes"

const none: readonly any[] = []

export const extendView = new ExtensionType

export const handleDOMEvents = extendView.behavior<{[key: string]: (view: EditorView, event: any) => boolean}>()

export const clickAddsSelectionRange = extendView.behavior<(event: MouseEvent) => boolean>()

export const dragMovesSelection = extendView.behavior<(event: MouseEvent) => boolean>()

// FIXME this should work differently
export const themeClass = extendView.behavior<(tag: string) => string>()

/// View plugins are stateful objects that are associated with a view.
/// They can influence the way the content is drawn, and are notified
/// of things that happen in the view.
///
/// If you declare a constructor for a view plugin, you should make it
/// take an [`EditorView`](#view.EditorView) as first argument and,
/// optionally, a configuration value as second. Registering plugins
/// is done with [`ViewPlugin.extension`](#view.ViewPlugin^extension),
/// which expects that constructor signature. The constructor should
/// set up internal state, but not mutate the DOM—the `draw` function
/// will be called after the editor has initialized.
///
/// When a plugin method throws an exception, the error will be logged
/// to the console and the plugin will be disabled for the rest of the
/// view's lifetime (to avoid leaving it in an invalid state).
export interface ViewPluginValue<T = undefined> {
  /// Notify the plugin of an update that happened in the view. This
  /// is called _before_ the view updates its DOM. It is responsible
  /// for updating the plugin's internal state and its
  /// `decoration`/`editorAttributes`/`contentAttributes` properties.
  /// It should _not_ change the DOM, or read the DOM in a way that
  /// triggers a layout recomputation.
  update(update: ViewUpdate): void

  /// This is called after the view updated (or initialized) its DOM
  /// structure. It may write to the DOM (outside of the editor
  /// content). It should not trigger a DOM layout.
  draw?(): void

  measure?(): T
  drawMeasured?(measurement: T): void

  /// Called when the plugin is no longer going to be used.
  destroy?(): void
}

export class ViewPlugin<T extends ViewPluginValue> {
  /// @internal
  id = extendView.storageID()
  readonly extension: Extension

  constructor(
    /// @internal
    readonly create: (view: EditorView) => T
  ) {
    this.extension = viewPlugin(this)
  }

  behavior<Input>(behavior: Behavior<Input, any>, read: (plugin: T) => Input): Extension {
    return extendView.dynamic(behavior, (values: Values) => read(values[this.id]))
  }

  decoration(read: (plugin: T) => DecorationSet) {
    return this.behavior(decoration, read)
  }

  /// Create a view plugin extension that only computes decorations.
  /// When `map` is true, the set passed to `update` will already have
  /// been mapped through the transactions in the `ViewUpdate`.
  static decoration(spec: {
    create: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    let plugin = new ViewPlugin(view => new DecorationPlugin(view, spec))
    return Extension.all(plugin.extension, plugin.decoration(value => value.decorations))
  }
}

export const editorAttributes = extendView.behavior<Attrs, Attrs>({
  combine: values => values.reduce((a, b) => combineAttrs(b, a), {})
})

export const contentAttributes = extendView.behavior<Attrs, Attrs>({
  combine: values => values.reduce((a, b) => combineAttrs(b, a), {})
})

// Registers view plugins.
export const viewPlugin = extendView.behavior<ViewPlugin<any>>({static: true})

// Provide decorations
export const decoration = extendView.behavior<DecorationSet>()

class DecorationPlugin implements ViewPluginValue {
  decorations: DecorationSet
  
  constructor(view: EditorView, readonly spec: {
    create: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    this.decorations = spec.create(view)
  }

  update(update: ViewUpdate) {
    this.decorations = this.spec.update(this.spec.map ? this.decorations.map(update.changes) : this.decorations, update)
  }
}

export const styleModule = extendView.behavior<StyleModule>()

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
