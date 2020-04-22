import {ChangeSet, Mapping} from "@codemirror/next/text"
import {EditorState, ChangeSpec} from "./state"
import {EditorSelection} from "./selection"
import {Extension, ExtensionMap} from "./facet"

/// Annotations are tagged values that are used to add metadata to
/// transactions in an extensible way. They should be used to model
/// things that effect the entire transaction (such as its [time
/// stamp](#state.Transaction^time) or information about its
/// [origin](#state.Transaction^userEvent)). For effects that happen
/// _alongside_ the other changes made by the transaction, [state
/// effects](#state.StateEffect) are more appropriate.
export class Annotation<T> {
  /// @internal
  constructor(readonly type: AnnotationType<T>, readonly value: T) {}

  /// Define a new type of annotation.
  static define<T>() { return new AnnotationType<T>() }
}

/// Marker that identifies a type of [annotation](#state.Annotation).
export class AnnotationType<T> {
  of(value: T): Annotation<T> { return new Annotation(this, value) }
}

export const scrollIntoView = Annotation.define<boolean>()

/// Values passed to
/// [`StateEffect.define`](#state.StateEffect^define).
export interface StateEffectSpec<Value> {
  /// Provides a way to map an effect like this through a position
  /// mapping. When not given, the effects will simply not be mapped.
  /// When the function returns `undefined`, that means the mapping
  /// deletes the effect.
  map?: (value: Value, mapping: Mapping) => Value | undefined
}

/// State effects can be used to represent additional effects
/// associated with a [transaction](#state.Transaction.effects). They
/// are often useful to model changes to custom [state
/// fields](#state.StateField), when those changes aren't implicit in
/// document or selection changes.
export class StateEffect<Value> {
  /// @internal
  constructor(
    /// @internal
    readonly type: StateEffectType<Value>,
    /// The value of this effect.
    readonly value: Value) {}

  /// Map this effect through a position mapping. Will return
  /// `undefined` when that ends up deleting the effect.
  map(mapping: Mapping): StateEffect<Value> | undefined {
    let mapped = this.type.map(this.value, mapping)
    return mapped === undefined ? undefined : mapped == this.value ? this : new StateEffect(this.type, mapped)
  }

  /// Tells you whether this effect object is of a given
  /// [type](#state.StateEffectType).
  is<T>(type: StateEffectType<T>): this is StateEffect<T> { return this.type == type as any }

  /// Define a new effect type. The type parameter indicates the type
  /// of values that his effect holds.
  static define<Value = null>(spec: StateEffectSpec<Value> = {}): StateEffectType<Value> {
    return new StateEffectType(spec.map || (v => v))
  }
}

/// Representation of a type of state effect. Defined with
/// [`StateEffect.define`](#state.StateEffect^define).
export class StateEffectType<Value> {
  /// @internal
  constructor(
    // The `any` types in these function types are there to work
    // around TypeScript issue #37631, where the type guard on
    // `StateEffect.is` mysteriously stops working when these properly
    // have type `Value`.
    /// @internal
    readonly map: (value: any, mapping: Mapping) => any | undefined
  ) {}

  /// Create a [state effect](#state.StateEffect) instance of this
  /// type.
  of(value: Value): StateEffect<Value> { return new StateEffect(this, value) }
}

export type TransactionSpec = {
  changes?: ChangeSpec
  selection?: EditorSelection | {anchor: number, head?: number},
  effects?: readonly StateEffect<any>[],
  annotations?: readonly Annotation<any>[],
  scrollIntoView?: boolean,
  reconfigure?: Extension,
  // FIXME note symbol index type nonsense
  replaceExtensions?: ExtensionMap,
  filterChanges?: boolean
}

/// Changes to the editor state are grouped into transactions.
/// Typically, a user action creates a single transaction, which may
/// contain any number of document changes, may change the selection,
/// or have other effects. Create a transaction by calling
/// [`EditorState.tr`](#state.EditorState.tr).
export class Transaction {
  // Cached result of `apply`.
  private newState: EditorState | null = null

  /// @internal
  constructor(
    /// The state from which the transaction starts.
    readonly startState: EditorState,
    /// The document changes made by this transaction.
    readonly changes: ChangeSet,
    /// The selection set by this transaction, or null if it doesn't
    /// explicitly set a selection.
    readonly selection: EditorSelection | undefined,
    /// The effects added to the transaction.
    readonly effects: readonly StateEffect<any>[],
    private annotations: readonly Annotation<any>[],
    /// @internal
    readonly reconfigure: {base: Extension, replace: ExtensionMap} | undefined
  ) {}

  /// Apply the transaction, producing a new editor state. Calling
  /// this multiple times will not result in new states being
  /// computed.
  apply(): EditorState {
    return this.newState || (this.newState = this.startState.applyTransaction(this))
  }

  /// Get the value of the given annotation type, if any.
  annotation<T>(type: AnnotationType<T>): T | undefined {
    for (let ann of this.annotations) if (ann.type == type) return ann.value
    return undefined
  }

  /// Indicates whether the transaction changed the document.
  get docChanged(): boolean { return !this.changes.empty }

  /// Query whether the selection should be scrolled into view after
  /// applying this transaction.
  get scrolledIntoView(): boolean { return this.annotation(scrollIntoView) != null }

  /// Indicates whether the transaction reconfigures the state.
  get reconfigured(): boolean { return !!this.reconfigure }

  and(tr: Transaction | TransactionSpec) {
    if (!(tr instanceof Transaction)) tr = this.startState.tr(tr)
    if (tr.startState != this.startState) throw new Error("Trying to combine mismatched transaction (different start state)")
    let trMap = this.effects.length || this.selection && !tr.selection ? tr.changes.desc.map(this.changes) : null
    let thisMap = tr.effects.length || tr.selection ? this.changes.desc.map(tr.changes) : null
    return new Transaction(this.startState, this.changes.combine(tr.changes),
                           tr.selection ? tr.selection.map(thisMap!) : this.selection ? this.selection.map(trMap!) : undefined,
                           mapEffects(this.effects, trMap!).concat(mapEffects(tr.effects, thisMap!)),
                           this.annotations.concat(tr.annotations),
                           combineReconf(this.reconfigure, tr.reconfigure))
  }

  /// Annotation used to store transaction timestamps.
  static time = Annotation.define<number>()

  /// Annotation used to indicate that this transaction shouldn't
  /// clear the goal column, which is used during vertical cursor
  /// motion (so that moving over short lines doesn't reset the
  /// horizontal position to the end of the shortest line). Should
  /// generally only be set by commands that perform vertical motion.
  static preserveGoalColumn = Annotation.define<boolean>()

  /// Annotation used to associate a transaction with a user interface
  /// event. The view will set this to...
  ///
  ///  - `"paste"` when pasting content
  ///  - `"cut"` when cutting
  ///  - `"drop"` when content is inserted via drag-and-drop
  ///  - `"keyboard"` when moving the selection via the keyboard
  ///  - `"pointer"` when moving the selection through the pointing device
  static userEvent = Annotation.define<string>()

  /// Annotation indicating whether a transaction should be added to
  /// the undo history or not.
  static addToHistory = Annotation.define<boolean>()

  /// Annotation that should be used by transactions that reorder
  /// changes (typically for collaborative editing), introducing new
  /// changes before existing changes by first undoing a sequence of
  /// changes (the count of which is the value of the annotation),
  /// then applying other changes, and then re-doing (a mapped form
  /// of) the old changes. The transaction's `changes.getMirror`
  /// method can be used to figure out which forward change (if any)
  /// corresponds to each inverted change.
  static rebasedChanges = Annotation.define<number>()
}

function combineReconf(a: {base: Extension, replace: ExtensionMap} | undefined,
                       b: {base: Extension, replace: ExtensionMap} | undefined) {
  if (!b) return a
  if (!a || a.base != b.base) return b
  let replace = Object.create(null)
  for (let tag in a.replace) replace[tag] = a.replace[tag]
  for (let tag in b.replace) replace[tag] = b.replace[tag]
  return {base: b.base, replace}
}

function mapEffects(effects: readonly StateEffect<any>[], mapping: Mapping) {
  if (!effects.length) return effects
  let result = []
  for (let effect of effects) {
    let mapped = effect.map(mapping)
    if (mapped) result.push(effect)
  }
  return result
}
