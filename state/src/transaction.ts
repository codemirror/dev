import {ChangeSet, ChangeDesc, ChangeSpec} from "./change"
import {EditorState} from "./state"
import {EditorSelection} from "./selection"
import {Extension, ExtensionMap} from "./facet"
import {changeFilter, transactionFilter} from "./extension"

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

  /// Map an array of effects through a change set.
  static mapEffects(effects: readonly StateEffect<any>[], mapping: ChangeDesc) {
    if (!effects.length) return effects
    let result = []
    for (let effect of effects) {
      let mapped = effect.map(mapping)
      if (mapped) result.push(mapped)
    }
    return result
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

/// Describes a [transaction](#state.Transaction) when calling the
/// [`EditorState.update`](#state.EditorState.update) method.
export type TransactionSpec = {
  /// The changes to the document made by this transaction.
  changes?: ChangeSpec
  /// When set, this transaction explicitly updates the selection.
  /// Offsets in this selection should refer to the document as it is
  /// _after_ the transaction.
  selection?: EditorSelection | {anchor: number, head?: number},
  /// Attach [state effects](#state.StateEffect) to this transaction.
  effects?: StateEffect<any> | readonly StateEffect<any>[],
  /// Set [annotations](#state.Annotation) for this transaction.
  annotations?: Annotation<any> | readonly Annotation<any>[],
  /// When set to `true`, the transaction is marked as needing to
  /// scroll the current selection into view.
  scrollIntoView?: boolean,
  /// By default, transactions can be modified by [change
  /// filters](#state.EditorState.changeFilter) and [transaction
  /// filters](#state.EditorState.transactionFilter). You can set this
  /// to `false` to disable that.
  filter?: boolean,
  /// When given, the state will be reconfigured to use a new set of
  /// extensions instead of its old configuration.
  reconfigure?: Extension,
  /// [Tagged extensions](#state.tagExtension) can be used to
  /// partially configure a state by replacing specific parts of its
  /// configuration. (Note that the keys in this object may also be
  /// symbols, even though the TypeScript type can't express that.)
  replaceExtensions?: ExtensionMap
}

/// A [transactions spec](#state.TransactionSpec) with most of its
/// fields narrowed down to more predictable types. This type is used
/// to pass something more usable than a raw transaction spec to, for
/// example, [change filters](#state.EditorState^changeFilter).
export type StrictTransactionSpec = {
  changes: ChangeSet,
  selection: EditorSelection | undefined,
  effects: readonly StateEffect<any>[],
  annotations: readonly Annotation<any>[],
  scrollIntoView: boolean,
  filter: boolean,
  reconfigure: Extension | undefined,
  replaceExtensions: ExtensionMap | undefined
}

export const enum TransactionFlag { reconfigured = 1, scrollIntoView = 2 }

/// Changes to the editor state are grouped into transactions.
/// Typically, a user action creates a single transaction, which may
/// contain any number of document changes, may change the selection,
/// or have other effects. Create a transaction by calling
/// [`EditorState.update`](#state.EditorState.update).
export class Transaction {
  /// The new state created by the transaction.
  readonly state!: EditorState

  /// @internal
  constructor(
    /// The state from which the transaction starts.
    readonly startState: EditorState,
    /// The document changes made by this transaction.
    readonly changes: ChangeSet,
    /// The selection set by this transaction, or undefined if it
    /// doesn't explicitly set a selection.
    readonly selection: EditorSelection | undefined,
    /// The effects added to the transaction.
    readonly effects: readonly StateEffect<any>[],
    private annotations: readonly Annotation<any>[],
    private flags: number
  ) {
    if (!this.annotations.some((a: Annotation<any>) => a.type == Transaction.time))
      this.annotations = this.annotations.concat(Transaction.time.of(Date.now()))
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
  get scrolledIntoView(): boolean { return (this.flags & TransactionFlag.scrollIntoView) > 0 }

  /// Indicates whether the transaction reconfigures the state.
  get reconfigured(): boolean { return (this.flags & TransactionFlag.reconfigured) > 0 }

  /// Annotation used to store transaction timestamps.
  static time = Annotation.define<number>()

  /// Annotation used to associate a transaction with a user interface
  /// event. The view will set this to...
  ///
  ///  - `"input"` when the user types text
  ///  - `"delete"` when the user deletes the selection or text near the selection
  ///  - `"keyboardselection"` when moving the selection via the keyboard
  ///  - `"pointerselection"` when moving the selection through the pointing device
  ///  - `"paste"` when pasting content
  ///  - `"cut"` when cutting
  ///  - `"drop"` when content is inserted via drag-and-drop
  static userEvent = Annotation.define<string>()

  /// Annotation indicating whether a transaction should be added to
  /// the undo history or not.
  static addToHistory = Annotation.define<boolean>()
}

export class ResolvedTransactionSpec implements StrictTransactionSpec {
  constructor(readonly changes: ChangeSet,
              readonly selection: EditorSelection | undefined,
              readonly effects: readonly StateEffect<any>[],
              readonly annotations: readonly Annotation<any>[],
              readonly scrollIntoView: boolean,
              readonly filter: boolean,
              readonly reconfigure: Extension | undefined,
              readonly replaceExtensions: ExtensionMap | undefined) {}

  static create(state: EditorState, specs: TransactionSpec | readonly TransactionSpec[]): ResolvedTransactionSpec {
    let spec: TransactionSpec
    if (Array.isArray(specs)) {
      if (specs.length) return specs.map(s => ResolvedTransactionSpec.create(state, s)).reduce((a, b) => a.combine(b))
      spec = {}
    } else if (specs instanceof ResolvedTransactionSpec) {
      return specs
    } else {
      spec = specs as TransactionSpec
    }
    let sel = spec.selection
    return new ResolvedTransactionSpec(
      spec.changes ? state.changes(spec.changes) : ChangeSet.empty(state.doc.length),
      sel && (sel instanceof EditorSelection ? sel : EditorSelection.single(sel.anchor, sel.head)),
      !spec.effects ? none : Array.isArray(spec.effects) ? spec.effects : [spec.effects],
      !spec.annotations ? none : Array.isArray(spec.annotations) ? spec.annotations : [spec.annotations],
      !!spec.scrollIntoView,
      spec.filter !== false,
      spec.reconfigure,
      spec.replaceExtensions)
  }

  combine(b: ResolvedTransactionSpec) {
    let a: ResolvedTransactionSpec = this
    let changesA = a.changes.mapDesc(b.changes, true), changesB = b.changes.map(a.changes)
    return new ResolvedTransactionSpec(
      a.changes.compose(changesB),
      b.selection ? b.selection.map(changesA) : a.selection ? a.selection.map(changesB) : undefined,
      StateEffect.mapEffects(a.effects, changesB).concat(StateEffect.mapEffects(b.effects, changesA)),
      a.annotations.length ? a.annotations.concat(b.annotations) : b.annotations,
      a.scrollIntoView || b.scrollIntoView,
      a.filter && b.filter,
      b.reconfigure || a.reconfigure,
      b.replaceExtensions || (b.reconfigure ? undefined : a.replaceExtensions))
  }

  filterChanges(state: EditorState) {
    if (!this.filter) return this
    let result: boolean | readonly number[] = true
    for (let filter of state.facet(changeFilter)) {
      let value = filter(this, state)
      if (value === false) { result = false; break }
      if (Array.isArray(value)) result = result === true ? value : joinRanges(result, value)
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
      StateEffect.mapEffects(this.effects, back),
      this.annotations,
      this.scrollIntoView,
      this.filter,
      this.reconfigure,
      this.replaceExtensions)
  }

  filterTransaction(state: EditorState) {
    if (!this.filter) return this
    let result: ResolvedTransactionSpec = this
    let filters = state.facet(transactionFilter)
    for (let i = filters.length - 1; i >= 0; i--)
      result = ResolvedTransactionSpec.create(state, filters[i](result, state))
    return result
  }
}

function joinRanges(a: readonly number[], b: readonly number[]) {
  let result = []
  for (let iA = 0, iB = 0;;) {
    let from, to
    if (iA < a.length && (iB == b.length || b[iB] >= a[iA])) { from = a[iA++]; to = a[iA++] }
    else if (iB < b.length) { from = b[iB++]; to = b[iB++] }
    else return result
    if (!result.length || result[result.length - 1] < from) result.push(from, to)
    else if (result[result.length - 1] < to) result[result.length - 1] = to
  }
}

const none: readonly any[] = []
