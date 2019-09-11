import {EditorState, Transaction, ChangeSet} from "../../state/src"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet, Decoration} from "./decoration"
import {ExtensionType, Slot, SlotType} from "../../extension/src/extension"
import {EditorView} from "./editorview"
import {Attrs} from "./attributes"

export type Effect<T> = SlotType<(field: any) => T>

const none: any[] = []

/// View fields are used to keep extra state in the view and to create
/// decorations and other effects that influence how the view is
/// drawn.
export class ViewField<V> {
  /// @internal
  readonly create: (view: EditorView) => V
  /// @internal
  readonly update: (value: V, update: ViewUpdate) => V
  /// @internal
  readonly effects: Slot<(field: V) => any>[]
  
  /// Create a view field with the given initialization and update
  /// function. When given `effects` determines with effects this
  /// field has on the view.
  constructor({create, update, effects = []}: {
    create: (view: EditorView) => V
    update: (value: V, update: ViewUpdate) => V,
    effects?: Slot<(field: V) => any>[]
  }) {
    this.create = create; this.update = update; this.effects = effects
  }

  /// The extension (to be passed in the
  /// [`extensions`](#view.EditorConfig.extensions) field when creating
  /// a view) that installs this field.
  get extension() { return viewField(this) }

  /// Define an effect that produces decorations from a given field
  /// value.
  static decorationEffect = Slot.define<(field: any) => DecorationSet>()
  /// Define an effect that influences the attributes on the editor
  /// view's outer element.
  static editorAttributeEffect = Slot.define<(field: any) => (Attrs | null)>()
  /// Define an effect that sets attributes on the editable element in
  /// a view.
  static contentAttributeEffect = Slot.define<(field: any) => (Attrs | null)>()

  /// Create a view field extension that only computes decorations.
  /// When `map` is true, the set passed to `update` will already have
  /// been mapped through the transactions in the `ViewUpdate`.
  static decorations({create, update, map}: {
    create?: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    return new ViewField<DecorationSet>({
      create: create || (() => Decoration.none),
      update(deco: DecorationSet, u: ViewUpdate) {
        if (map) deco = deco.map(u.changes)
        return update(deco, u)
      },
      effects: [ViewField.decorationEffect(d => d)]
    }).extension
  }

  /// Create a view field extension that only computes an
  /// [`editorAttributeEffect`](#view.ViewField.editorAttributeEffect).
  static editorAttributes = attributeField(ViewField.editorAttributeEffect)

  /// Create a view field extension that only computes a
  /// [`contentAttributeEffect`](#view.ViewField.contentAttributeEffect).
  static contentAttributes = attributeField(ViewField.contentAttributeEffect)
}

function attributeField(effect: Effect<Attrs | null>) {
  return function(value: Attrs | ((view: EditorView) => Attrs | null),
                  update?: (value: Attrs | null, update: ViewUpdate) => Attrs | null) {
    return new ViewField<Attrs | null>({
      create: value instanceof Function ? value : () => value,
      update: update || (a => a), effects: [effect(a => a)]
    }).extension
  }
}

export const extendView = new ExtensionType

export const viewField = extendView.behavior<ViewField<any>>()

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
export interface ViewPlugin {
  update?: (update: ViewUpdate) => void
  destroy?: () => void
}
// FIXME allow a phase distinction between DOM reading and dom writing
// here? (For something like a tooltip plugin that needs to figure out
// the tooltip position and then update some DOM—don't want to force a
// relayout for every plugin that does that.)

/// Extension to register view plugins. Call this value with the
/// plugin's constructor, and [add](#view.EditorConfig.extensions) the
/// result to the view.
export const viewPlugin = extendView.behavior<(view: EditorView) => ViewPlugin>()

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
  // @internal
  readonly prevFields: ReadonlyArray<ViewField<any>>
  // @internal
  readonly prevFieldValues: ReadonlyArray<any>
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
    this.prevFields = view.fields
    this.prevFieldValues = view.fieldValues
    this.prevViewport = view.viewport
  }

  /// The new viewport range.
  get viewport() { return this.view.viewport }

  // FIXME remove?
  /// Access a view field's value as it was before the update (only
  /// meaningful for view fields whose content isn't mutated).
  prevField<T>(field: ViewField<T>): T
  prevField<T, D = undefined>(field: ViewField<T>, defaultValue?: D): T | D {
    return getField(field, this.prevFields, this.prevFieldValues, defaultValue)
  }

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

export function getField<T, D = undefined>(field: ViewField<T>, fields: ReadonlyArray<ViewField<any>>,
                                           values: ReadonlyArray<any>, defaultValue?: D): T | D {
  let index = fields.indexOf(field)
  if (index < 0) {
    if (defaultValue === undefined) throw new RangeError("Field isn't present")
    else return defaultValue
  }
  if (index >= values.length) throw new RangeError("Accessing a field that isn't initialized yet")
  return values[index] as T
}
