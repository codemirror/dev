import {EditorState, Transaction, ChangeSet, Facet, Extension} from "../../state"
import {StyleModule} from "style-mod"
import {DecorationSet} from "./decoration"
import {EditorView} from "./editorview"
import {Attrs, combineAttrs} from "./attributes"
import {Rect} from "./dom"

/// Command functions are used in key bindings and other types of user
/// actions. Given an editor view, they check whether their effect can
/// apply to the editor, and if it can, perform it as a side effect
/// (which usually means dispatching a transaction) and return `true`.
export type Command = (target: EditorView) => boolean

const none: readonly any[] = []

export const domEventHandlers = Facet.define<{[key: string]: (view: EditorView, event: any) => boolean}>()

export const clickAddsSelectionRange = Facet.define<(event: MouseEvent) => boolean>()

export const dragMovesSelection = Facet.define<(event: MouseEvent) => boolean>()

/// This is the interface plugin objects conform to.
export interface PluginValue {
  /// Notifies the plugin of an update that happened in the view. This
  /// is called _before_ the view updates its DOM. It is responsible
  /// for updating the plugin's internal state (including any state
  /// that may be read by behaviors). It should _not_ change the DOM,
  /// or read the DOM in a way that triggers a layout recomputation.
  update?(_update: ViewUpdate): void

  /// Called when the plugin is no longer going to be used. Should
  /// revert any changes the plugin made to the DOM.
  destroy?(): void
}

/// Plugin fields are a mechanism for allowing plugins to provide
/// values that can be retrieved through the
/// [`pluginValues`](#view.EditorView.pluginValues) view method.
export class PluginField<T> {
  static define<T>() { return new PluginField<T>() }

  /// Plugins can provide additional scroll margins (space around the
  /// sides of the scrolling element that should be considered
  /// invisible) through this field. This can be useful when the
  /// plugin introduces elements that cover part of that element (for
  /// example a horizontally fixed gutter).
  static scrollMargins = PluginField.define<Partial<Rect> | null>()
}

let nextPluginID = 0

export const viewPlugin = Facet.define<ViewPlugin<any>>()

/// View plugins associate stateful values with a view. They can
/// influence the way the content is drawn, and are notified of things
/// that happen in the view.
export class ViewPlugin<T extends PluginValue> {
  /// Instances of this class act as extensions.
  extension: Extension

  private constructor(
    /// @internal
    readonly id: number,
    /// @internal
    readonly create: (view: EditorView) => T,
    /// @internal
    readonly fields: readonly {field: PluginField<any>, get: (plugin: T) => any}[]
  ) {
    this.extension = viewPlugin.of(this)
  }

  /// Define a plugin from a constructor function that creates the
  /// plugin's value, given an editor view.
  static define<T extends PluginValue>(create: (view: EditorView) => T) {
    return new ViewPlugin<T>(nextPluginID++, create, [])
  }

  /// Create a plugin for a class whose constructor takes a single
  /// editor view as argument.
  static fromClass<T extends PluginValue>(cls: {new (view: EditorView): T}) {
    return ViewPlugin.define(view => new cls(view))
  }

  /// Create a new version of this plugin that provides a given
  /// [plugin field](#view.PluginField).
  provide<V>(field: PluginField<V>, get: (plugin: T) => V) {
    return new ViewPlugin(this.id, this.create, this.fields.concat({field, get}))
  }

  /// Create a new version of this plugin that provides decorations.
  /// Decorations provided by plugins can observe the editor and base
  /// on, for example, the current viewport. On the other hand, they
  /// should not influence the viewport, for example through collapsed
  /// regions or large widgets.
  ///
  /// When the plugin value type has a `decorations` property, that is
  /// used to provide the decorations when no explicit getter is
  /// provided.
  decorations<V extends {decorations: DecorationSet} & PluginValue>(this: ViewPlugin<V>): ViewPlugin<T>
  decorations(get: (plugin: T) => DecorationSet): ViewPlugin<T>
  decorations(get?: (plugin: T) => DecorationSet) {
    return this.provide(pluginDecorations, get || ((value: any) => value.decorations))
  }
}

// FIXME somehow ensure that no replacing decorations end up in here
export const pluginDecorations = PluginField.define<DecorationSet>()

export class PluginInstance {
  updateFunc: (update: ViewUpdate) => void

  constructor(readonly value: PluginValue, readonly spec: ViewPlugin<any>) {
    this.updateFunc = this.value.update ? this.value.update.bind(this.value) : () => undefined
  }

  static create(spec: ViewPlugin<any>, view: EditorView) {
    let value
    try { value = spec.create(view) }
    catch (e) {
      console.error("CodeMirror plugin crashed:", e)
      return PluginInstance.dummy
    }
    return new PluginInstance(value, spec)
  }

  takeField<T>(type: PluginField<T>, target: T[]) {
    for (let {field, get} of this.spec.fields) if (field == type) target.push(get(this.value))
  }

  update(update: ViewUpdate) {
    try {
      this.updateFunc(update)
      return this
    } catch (e) {
      console.error("CodeMirror plugin crashed:", e)
      if (this.value.destroy) try { this.value.destroy() } catch (_) {}
      return PluginInstance.dummy
    }
  }

  destroy() {
    try { if (this.value.destroy) this.value.destroy() }
    catch (e) { console.error("CodeMirror plugin crashed:", e) }
  }

  static dummy = new PluginInstance({}, ViewPlugin.define(() => ({})))
}

export interface MeasureRequest<T> {
  key?: any
  read(view: EditorView): T
  write(measure: T, view: EditorView): void
}

export const editorAttributes = Facet.define<Attrs, Attrs>({
  combine: values => values.reduce((a, b) => combineAttrs(b, a), {})
})

export const contentAttributes = Facet.define<Attrs, Attrs>({
  combine: values => values.reduce((a, b) => combineAttrs(b, a), {})
})

// Provide decorations
export const decorations = Facet.define<DecorationSet>()

export const styleModule = Facet.define<StyleModule>()

export const phrases = Facet.define<{[key: string]: string}>()

export const enum UpdateFlag { Focus = 1, Height = 2, Viewport = 4, Oracle = 8, LineGaps = 16 }

/// View [plugins](#view.ViewPlugin) are given instances of this
/// class, which describe what happened, whenever the view is updated.
export class ViewUpdate {
  /// The changes made to the document by this update.
  readonly changes: ChangeSet
  /// The previous editor state.
  readonly prevState: EditorState
  /// @internal
  flags = 0

  /// @internal
  constructor(
    /// The editor view that the update is associated with.
    readonly view: EditorView,
  /// The new editor state.
    readonly state: EditorState,
    /// The transactions involved in the update. May be empty.
    readonly transactions: readonly Transaction[] = none
  ) {
    this.changes = transactions.reduce((chs, tr) => chs.appendSet(tr.changes), ChangeSet.empty)
    this.prevState = view.state
    let focus = view.hasFocus
    if (focus != view.inputState.notifiedFocused) {
      view.inputState.notifiedFocused = focus
      this.flags != UpdateFlag.Focus
    }
    if (this.docChanged) this.flags |= UpdateFlag.Height
  }

  /// Tells you whether the viewport changed in this update.
  get viewportChanged() {
    return (this.flags & UpdateFlag.Viewport) > 0
  }

  /// Indicates whether the line height in the editor changed in this update.
  get heightChanged() {
    return (this.flags & UpdateFlag.Height) > 0
  }

  /// True when this update indicates a focus change.
  get focusChanged() {
    return (this.flags & UpdateFlag.Focus) > 0
  }

  /// Whether the document changed in this update.
  get docChanged() {
    return this.transactions.some(tr => tr.docChanged)
  }

  /// Whether the selection was explicitly set in this update.
  get selectionSet() {
    return this.transactions.some(tr => tr.selectionSet)
  }

  /// @internal
  get empty() { return this.flags == 0 && this.transactions.length == 0 }
}
