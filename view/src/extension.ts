import {EditorState, Transaction, ChangeSet, Annotation, Facet} from "../../state"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
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

export const handleDOMEvents = Facet.define<{[key: string]: (view: EditorView, event: any) => boolean}>()

export const clickAddsSelectionRange = Facet.define<(event: MouseEvent) => boolean>()

export const dragMovesSelection = Facet.define<(event: MouseEvent) => boolean>()

/// View plugins associate stateful values with a view. They can
/// influence the way the content is drawn, and are notified of things
/// that happen in the view.
export interface ViewPlugin<Measure = undefined> {
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
  ///
  /// May return `true` to request another cycle of
  /// `measure`/`drawMeasured` calls.
  drawMeasured?(measured: Measure): boolean

  /// Called when the plugin is no longer going to be used. Should
  /// revert any changes the plugin made to the DOM.
  destroy?(): void
}

export const viewPlugin = Facet.define<(view: EditorView) => ViewPlugin<any>>()

export const editorAttributes = Facet.define<Attrs, Attrs>({
  combine: values => values.reduce((a, b) => combineAttrs(b, a), {})
})

export const contentAttributes = Facet.define<Attrs, Attrs>({
  combine: values => values.reduce((a, b) => combineAttrs(b, a), {})
})

// Provide decorations
export const decorations = Facet.define<DecorationSet>()

export const styleModule = Facet.define<StyleModule>()

export const theme = Facet.define<StyleModule<{[key: string]: string}>>()

export const phrases = Facet.define<{[key: string]: string}>()

export const scrollMargins = Facet.define<{left?: number, top?: number, right?: number, bottom?: number}, Rect>({
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
    return this.prevState.facet(theme) != this.view.state.facet(theme)
  }

  /// Get the value of the given annotation, if it was passed directly
  /// for the update or present in any of the transactions involved in
  /// the update.
  annotation<T>(type: (value: T) => Annotation<T>): T | undefined {
    for (let ann of this._annotations)
      if (ann.type == type) return ann.value as T
    for (let i = this.transactions.length - 1; i >= 0; i--) {
      let value = this.transactions[i].annotation(type)
      if (value !== undefined) return value
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
