import {EditorState, Transaction, ChangeSet, Annotation} from "../../state"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet} from "./decoration"
import {Extension, Behavior, ExtensionGroup} from "../../extension"
import {EditorView} from "./editorview"
import {Attrs, combineAttrs} from "./attributes"
import {Rect} from "./dom"

/// Some [command functions](#state.Command) need direct access to the
/// [editor view](#view.EditorView). View commands are expect a view
/// object as argument. [`Command`](#state.Command) is a subtype of
/// `ViewCommand`, and code that expects any kind of command usually
/// works with the `ViewCommand` type. (The distinction is mostly
/// there because most commands do not need an entire view, and it is
/// helpful to be able to test them in isolation, outside of the
/// browser.)
export type ViewCommand = (target: EditorView) => boolean

const none: readonly any[] = []

export const extendView = new ExtensionGroup<EditorView>(view => view.plugins)

export const handleDOMEvents = extendView.behavior<{[key: string]: (view: EditorView, event: any) => boolean}>()

export const clickAddsSelectionRange = extendView.behavior<(event: MouseEvent) => boolean>()

export const dragMovesSelection = extendView.behavior<(event: MouseEvent) => boolean>()

/// View plugins associate stateful values with a view. They can
/// influence the way the content is drawn, and are notified of things
/// that happen in the view. They can be combined with [dynamic
/// behavior](#extension.ExtensionGroup.dynamic) to
/// [add](#view.EditorView^decorations)
/// [decorations](#view.Decoration) to the view. Objects of this type
/// serve as keys to [access](#view.EditorView.plugin) the value of
/// the plugin.
export class ViewPlugin<Value extends ViewPluginValue<any>> {
  private constructor(
    /// @internal
    readonly create: (view: EditorView) => Value,
    /// @internal
    readonly id: number,
    /// @internal
    readonly behaviorExtensions: readonly Extension[]
  ) {}

  /// An extension that can be used to install this plugin in a view.
  get extension(): Extension {
    if (!this.create)
      throw new Error("Can't use a viewplugin that doesn't have a create function associated with it (use `.configure`)")
    return [viewPlugin(this), ...this.behaviorExtensions]
  }

  /// Declare a plugin. The `create` function will be called while
  /// initializing or reconfiguring an editor view to create the
  /// actual plugin instance. You can leave it empty, in which case
  /// you have to call `configure` before you are able to use the
  /// plugin.
  static create<Value extends ViewPluginValue<any>>(create: (view: EditorView) => Value) {
    return new ViewPlugin<Value>(create, extendView.storageID(), [])
  }

  /// Declare a behavior as a function of this plugin. `read` maps
  /// from the plugin value to the behavior's input type.
  behavior<Input>(behavior: Behavior<Input, any>, read: (plugin: Value) => Input): ViewPlugin<Value> {
    return new ViewPlugin<Value>(this.create, this.id, this.behaviorExtensions.concat(
      extendView.dynamic(behavior, view => read(view.plugin(this)!))
    ))
  }

  /// Declare that this plugin provides [decorations](#view.EditorView^decorations).
  decorations(read: (plugin: Value) => DecorationSet) {
    return this.behavior(decorations, read)
  }

  /// Create a view plugin extension that only computes decorations.
  static decoration(spec: DecorationPluginSpec) {
    return ViewPlugin.create(view => new DecorationPlugin(view, spec)).decorations(p => p.decorations).extension
  }
}

/// See [`ViewPlugin.decoration`](#view.ViewPlugin^decoration).
export interface DecorationPluginSpec {
  /// Compute the initial set of decorations.
  create: (view: EditorView) => DecorationSet,
  /// Update the decorations for a view update.
  update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
  /// When this is true, the set passed to `update` will already have
  /// been mapped through the transactions in the `ViewUpdate`.
  map?: boolean
}

/// This is the interface to which plugins conform. The optional type
/// parameter is only useful when the plugin needs to
/// [measure](#view.ViewPluginValue.measure) DOM layout.
export interface ViewPluginValue<Measure = undefined> {
  /// Notifies the plugin of an update that happened in the view. This
  /// is called _before_ the view updates its DOM. It is responsible
  /// for updating the plugin's internal state (including any state
  /// that may be read by behaviors). It should _not_ change the DOM,
  /// or read the DOM in a way that triggers a layout recomputation.
  update?(update: ViewUpdate): void

  /// This is called after the view updated (or initialized) its DOM
  /// structure. It may write to the DOM (outside of the editor
  /// content). It should not trigger a DOM layout by reading DOM
  /// positions or dimensions.
  draw?(): void

  /// This will be called in the layout-reading phase of an editor
  /// update. It should, if the plugin needs to read DOM layout
  /// information, do this reading and wrap the information in the
  /// value that it returns. It should not have side effects.
  measure?(): Measure

  /// If the plugin also has a `measure` method, this method will be
  /// called at the end of the DOM-writing phase after a layout
  /// reading phase, with the result from the `measure` method as
  /// argument. Called before `draw`, in cases where both are called.
  drawMeasured?(measured: Measure): void

  /// Called when the plugin is no longer going to be used. Should, at
  /// the very least, undo any changes the plugin made to the DOM.
  destroy?(): void
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
export const decorations = extendView.behavior<DecorationSet>()

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

export const theme = extendView.behavior<StyleModule<{[key: string]: string}>>()

export const phrases = extendView.behavior<{[key: string]: string}>()

export const scrollMargins = extendView.behavior<{left?: number, top?: number, right?: number, bottom?: number}, Rect>({
  combine(rects) {
    let result = {left: 0, top: 0, right: 0, bottom: 0}
    for (let r of rects) {
      result.left = Math.max(result.left, r.left || 0)
      result.top = Math.max(result.top, r.top || 0)
      result.right = Math.max(result.right, r.right || 0)
      result.bottom = Math.max(result.bottom, r.bottom || 0)
    }
    return result
  }
})

export const focusChange = Annotation.define<boolean>()

export const notified = Annotation.define<boolean>()

/// View [plugins](#view.ViewPlugin) are given instances of this
/// class, which describe what happened, whenever the view is updated.
export class ViewUpdate {
  /// The new editor state.
  readonly state: EditorState
  /// The changes made to the document by this update.
  readonly changes: ChangeSet
  /// The previous editor state.
  readonly prevState: EditorState
  /// The previous viewport range.
  readonly prevViewport: Viewport
  private prevThemes: readonly StyleModule[]

  /// @internal
  constructor(
    /// The editor view that the update is associated with.
    readonly view: EditorView,
    /// The transactions involved in the update. May be empty.
    readonly transactions: readonly Transaction[] = none,
    /// @internal
    readonly _annotations: readonly Annotation<any>[] = none
  ) {
    this.state = transactions.length ? transactions[transactions.length - 1].apply() : view.state
    this.changes = transactions.reduce((chs, tr) => chs.appendSet(tr.changes), ChangeSet.empty)
    this.prevState = view.state
    this.prevViewport = view._viewport
    this.prevThemes = view.behavior(theme)
  }

  /// The new viewport range.
  get viewport(): {from: number, to: number} { return this.view._viewport }

  /// Tells you whether the viewport changed in this update.
  get viewportChanged() {
    return !this.prevViewport.eq(this.view._viewport)
  }

  /// Whether the document changed in this update.
  get docChanged() {
    return this.transactions.some(tr => tr.docChanged)
  }

  /// Tells you whether the set of active [theme
  /// extensions](#view.EditorView^theme) changed, which may require
  /// plugins to update [CSS class names](#view.EditorView.cssClass)
  /// on their DOM elements.
  get themeChanged() {
    return this.prevThemes != this.view.behavior(theme)
  }

  /// Get the value of the given annotation, if it was passed directly
  /// for the update or present in any of the transactions involved in
  /// the update.
  annotation<T>(type: (value: T) => Annotation<T>): T | undefined {
    for (let ann of this._annotations)
      if (ann.type == type) return ann.value as T
    for (let i = this.transactions.length - 1; i >= 0; i--) {
      let value = this.transactions[i].annotation(type)
      if (value) return value
    }
    return undefined
  }

  /// Get the values of all instances of the given annotation type
  /// present in the transactions or passed directly to
  /// [`update`](#view.EditorView.update).
  annotations<T>(type: (value: T) => Annotation<T>): readonly T[] {
    let result = none
    for (let tr of this.transactions) {
      let ann = tr.annotations(type)
      if (ann.length) result = result.concat(ann)
    }
    for (let ann of this._annotations) {
      if (ann.type == type) result = result.concat([ann.value as T])
    }
    return result
  }
}
