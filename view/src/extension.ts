import {EditorState, Transaction, ChangeSet, Facet, Extension} from "../../state"
 import {StyleModule} from "style-mod"
import {Decoration, DecorationSet} from "./decoration"
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

/// View plugins associate stateful values with a view. They can
/// influence the way the content is drawn, and are notified of things
/// that happen in the view.
export class ViewPlugin {
  /// Notifies the plugin of an update that happened in the view. This
  /// is called _before_ the view updates its DOM. It is responsible
  /// for updating the plugin's internal state (including any state
  /// that may be read by behaviors). It should _not_ change the DOM,
  /// or read the DOM in a way that triggers a layout recomputation.
  update(update: ViewUpdate): void {}

  /// Called when the plugin is no longer going to be used. Should
  /// revert any changes the plugin made to the DOM.
  destroy(): void {}

  // FIXME somehow ensure that no replacing decorations end up in here
  decorations!: DecorationSet

  scrollMargins!: Partial<Rect> | null

  /// An extension that registers this plugin. Only available for
  /// subclasses whose constructor can be called with a single
  /// [`EditorView`](#view.EditorView) object as argument.
  static get extension(this: {new (view: EditorView): ViewPlugin}): Extension {
    return (this as any)._extension || ((this as any)._extension = viewPlugin.of(view => new this(view)))
  }

  /// @internal
  static dummy = new class DummyPlugin extends ViewPlugin {}
}

ViewPlugin.prototype.decorations = Decoration.none
ViewPlugin.prototype.scrollMargins = null

export interface MeasureRequest<T> {
  key?: any
  read(view: EditorView): T
  write(measure: T, view: EditorView): void
}

export const viewPlugin = Facet.define<(view: EditorView) => ViewPlugin>()

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

export const enum UpdateFlag { Focus = 1, Height = 2, Viewport = 4, Oracle = 8 }

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
