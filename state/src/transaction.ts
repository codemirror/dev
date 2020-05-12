import {ChangeSet, ChangeDesc, ChangeSpec} from "./change"
import {EditorState} from "./state"
import {EditorSelection} from "./selection"
import {Extension, ExtensionMap} from "./facet"
import {changeFilter} from "./extension"

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

/// Values passed to
/// [`StateEffect.define`](#state.StateEffect^define).
export interface StateEffectSpec<Value> {
  /// Provides a way to map an effect like this through a position
  /// mapping. When not given, the effects will simply not be mapped.
  /// When the function returns `undefined`, that means the mapping
  /// deletes the effect.
  map?: (value: Value, mapping: ChangeDesc) => Value | undefined
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
  map(mapping: ChangeDesc): StateEffect<Value> | undefined {
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
    readonly map: (value: any, mapping: ChangeDesc) => any | undefined
  ) {}

  /// Create a [state effect](#state.StateEffect) instance of this
  /// type.
  of(value: Value): StateEffect<Value> { return new StateEffect(this, value) }
}

export type TransactionSpec = {
  changes?: ChangeSpec
  selection?: EditorSelection | {anchor: number, head?: number},
  effects?: StateEffect<any> | readonly StateEffect<any>[],
  annotations?: Annotation<any> | readonly Annotation<any>[],
  scrollIntoView?: boolean,
  reconfigure?: Extension,
  // FIXME note symbol index type nonsense
  replaceExtensions?: ExtensionMap
}

export const enum TransactionFlag { reconfigured = 1, scrollIntoView = 2 }

/// Changes to the editor state are grouped into transactions.
/// Typically, a user action creates a single transaction, which may
/// contain any number of document changes, may change the selection,
/// or have other effects. Create a transaction by calling
/// [`EditorState.tr`](#state.EditorState.tr).
export class Transaction {
  /// The new state created by the transaction.
  readonly state!: EditorState

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
    readonly flags: number
  ) {}

  /// Get the value of the given annotation type, if any.
  annotation<T>(type: AnnotationType<T>): T | undefined {
    for (let ann of this.annotations) if (ann.type == type) return ann.value
    return undefined
  }

  /// Indicates whether the transaction changed the document.
  get docChanged(): boolean { return !this.changes.empty }

  /// Query whether the selection should be scrolled into view after
  /// applying this transaction.
  get scrolledIntoView(): boolean { return (this.flags & TransactionFlag.scrollIntoView) > 0 }

  /// Indicates whether the transaction reconfigures the state.
  get reconfigured(): boolean { return (this.flags & TransactionFlag.reconfigured) > 0 }

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

  /// Annotation that can be used to turn off [change
  /// filters](#state.EditorChange^changeFilter) for this transaction.
  /// When this isn't explicitly set to `false`, change filtering is
  /// enabled.
  static filterChanges = Annotation.define<boolean>()
}

function intersectRanges(a: readonly number[], b: readonly number[]) {
  let result = []
  for (let iA = 0, iB = 0; iA < a.length;) {
    let fromA = a[iA++], toA = a[iA++]
    while (iB < b.length) {
      let fromB = b[iB], toB = b[iB + 1]
      if (fromB < toA && toB > fromA) result.push(Math.max(fromA, fromB), Math.min(toA, toB))
      if (toB >= toA) break
      iB += 2
    }
  }
  return result
}

export class ResolvedTransactionSpec {
  constructor(readonly changes: ChangeSet,
              readonly selection: EditorSelection | undefined,
              readonly effects: readonly StateEffect<any>[],
              readonly annotations: readonly Annotation<any>[],
              readonly scrollIntoView: boolean,
              readonly reconfigure: Extension | undefined,
              readonly replaceExtensions: ExtensionMap | undefined) {}

  static create(state: EditorState, spec: TransactionSpec) {
    let sel = spec.selection
    return new ResolvedTransactionSpec(
      spec.changes ? state.changes(spec.changes) : ChangeSet.empty(state.doc.length),
      sel && (sel instanceof EditorSelection ? sel : EditorSelection.single(sel.anchor, sel.head)),
      !spec.effects ? none : Array.isArray(spec.effects) ? spec.effects : [spec.effects],
      !spec.annotations ? none : Array.isArray(spec.annotations) ? spec.annotations : [spec.annotations],
      !!spec.scrollIntoView,
      spec.reconfigure,
      spec.replaceExtensions)
  }

  combine(b: ResolvedTransactionSpec) {
    let a: ResolvedTransactionSpec = this
    let changesA = a.changes.mapDesc(b.changes, true), changesB = b.changes.map(a.changes)
    return new ResolvedTransactionSpec(
      a.changes.compose(changesB),
      b.selection ? b.selection.map(changesA) : a.selection ? a.selection.map(changesB) : undefined,
      mapEffects(a.effects, changesB).concat(mapEffects(b.effects, changesA)),
      a.annotations.length ? a.annotations.concat(b.annotations) : b.annotations,
      a.scrollIntoView || b.scrollIntoView,
      b.reconfigure || a.reconfigure,
      b.replaceExtensions || (b.reconfigure ? undefined : a.replaceExtensions))
  }

  filterChanges(state: EditorState) {
    // FIXME appending changes
    let result: boolean | readonly number[] = true
    for (let filter of state.facet(changeFilter)) {
      let value = filter(this.changes, state)
      if (value === false) { result = false; break }
      if (Array.isArray(value)) result = result === true ? value : intersectRanges(result, value)
    }
    if (result === true) return this
    let changes, back
    if (result === false) {
      back = this.changes.invertedDesc
      changes = ChangeSet.empty(state.doc.length)
    } else {
      let filtered = this.changes.filter(result)
      changes = filtered.changes
      back = filtered.filtered.invertedDesc
    }
    return new ResolvedTransactionSpec(
      changes,
      this.selection && this.selection.map(back),
      mapEffects(this.effects, back),
      this.annotations,
      this.scrollIntoView,
      this.reconfigure,
      this.replaceExtensions)
  }
}

function mapEffects(effects: readonly StateEffect<any>[], mapping: ChangeDesc) {
  if (!effects.length) return effects
  let result = []
  for (let effect of effects) {
    let mapped = effect.map(mapping)
    if (mapped) result.push(effect)
  }
  return result
}

const none: readonly any[] = []
