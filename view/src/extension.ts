import {EditorState, Transaction, ChangeSet} from "../../state"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet} from "./decoration"
import {Extension, Behavior, ExtensionGroup, Slot, SlotType} from "../../extension"
import {EditorView} from "./editorview"
import {Attrs, combineAttrs} from "./attributes"

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

declare const pluginBehavior: unique symbol

/// View plugins are stateful objects that are associated with a view.
/// They can influence the way the content is drawn, and are notified
/// of things that happen in the view. They can be combined with
/// [dynamic behavior](#extension.ExtensionGroup.dynamic) to
/// [add](#view.EditorView^decorations)
/// [decorations](#view.Decoration) to the view.
export class ViewPlugin<T extends ViewPluginValue> {
  /// @internal
  id = extendView.storageID()

  /// An extension that can be used to install this plugin in a view.
  readonly extension: Extension

  /// Declare a plugin. The `create` function will be called while
  /// initializing or reconfiguring an editor view to create the
  /// actual plugin instance. You can optionally declare behavior
  /// associated with this plugin by passing an array of behavior
  /// declarations created through
  /// [`ViewPlugin.behavior`](#view.ViewPlugin^behavior) as second
  /// argument.
  constructor(
    /// @internal
    readonly create: (view: EditorView) => T,
    behavior: readonly {[pluginBehavior]: T}[] = none
  ) {
    let behaviorSpecs = behavior as any as {behavior: Behavior<any, any>, read: (plugin: T) => any}[]
    this.extension = [viewPlugin(this), ...behaviorSpecs.map(spec => {
      return extendView.dynamic(spec.behavior, view => spec.read(view.plugin(this)!))
    })]
  }

  /// Declare a behavior as a function of a view plugin. `read` maps
  /// from the plugin value to the behavior's input type.
  static behavior<Plugin, Input>(behavior: Behavior<Input, any>, read: (plugin: Plugin) => Input): {[pluginBehavior]: Plugin} {
    return {behavior, read} as any
  }

  /// Create a view plugin extension that only computes decorations.
  /// When `map` is true, the set passed to `update` will already have
  /// been mapped through the transactions in the `ViewUpdate`.
  static decoration(spec: {
    create: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    let plugin = new ViewPlugin(view => new DecorationPlugin(view, spec), [
      ViewPlugin.behavior(decorations, (p: DecorationPlugin) => p.decorations)
    ])
    return plugin.extension
  }
}

/// This is the interface to which plugins may conform.
export interface ViewPluginValue<Measure = undefined> {
  /// Notify the plugin of an update that happened in the view. This
  /// is called _before_ the view updates its DOM. It is responsible
  /// for updating the plugin's internal state (including any state
  /// that may be read by behaviors). It should _not_ change the DOM,
  /// or read the DOM in a way that triggers a layout recomputation.
  update?(update: ViewUpdate): void

  /// This is called after the view updated (or initialized) its DOM
  /// structure. It may write to the DOM (outside of the editor
  /// content). It should not trigger a DOM layout.
  draw?(): void

  /// This will be called in the layout-reading phase of an editor
  /// update. It should, if the plugin needs to read DOM layout
  /// information, do this reading and wrap the information into a
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

export const focusChange = Slot.define<boolean>()

export const notified = Slot.define<boolean>()

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
    readonly transactions: ReadonlyArray<Transaction> = none,
    // @internal
    readonly metadata: ReadonlyArray<Slot> = none
  ) {
    this.state = transactions.length ? transactions[transactions.length - 1].apply() : view.state
    this.changes = transactions.reduce((chs, tr) => chs.appendSet(tr.changes), ChangeSet.empty)
    this.prevState = view.state
    this.prevViewport = view.viewport
    this.prevThemes = view.behavior(theme)
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

  get themeChanged() {
    return this.prevThemes == this.view.behavior(theme)
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
