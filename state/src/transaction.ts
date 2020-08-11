import {ChangeSet, ChangeDesc, ChangeSpec} from "./change"
import {EditorState} from "./state"
import {EditorSelection, checkSelection} from "./selection"
import {changeFilter, transactionFilter} from "./extension"
import {Extension} from "./facet"
import {Text} from "@codemirror/next/text"

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

interface StateEffectSpec<Value> {
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
  /// Again, when they contain positions and this same spec makes
  /// changes, those positions should refer to positions in the
  /// updated document.
  effects?: StateEffect<any> | readonly StateEffect<any>[],
  /// Set [annotations](#state.Annotation) for this transaction.
  annotations?: Annotation<any> | readonly Annotation<any>[],
  /// When set to `true`, the transaction is marked as needing to
  /// scroll the current selection into view.
  scrollIntoView?: boolean,
  /// Specifies that the state should be reconfigured.
  reconfigure?: ReconfigurationSpec
  /// By default, transactions can be modified by [change
  /// filters](#state.EditorState^changeFilter) and [transaction
  /// filters](#state.EditorState^transactionFilter). You can set this
  /// to `false` to disable that.
  filter?: boolean,
  /// Normally, when multiple specs are combined (for example by
  /// [`EditorState.update`](#state.EditorState.update)), the
  /// positions in `changes` are taken to refer to the document
  /// positions in the initial document. When a spec has `sequental`
  /// set to true, its positions will be taken to refer to the
  /// document created by the specs before it instead.
  sequential?: boolean
}

/// Type used in [transaction specs](#state.TransactionSpec) to
/// indicate how the state should be reconfigured.
export type ReconfigurationSpec = {
  /// If given, this will replace the state's entire
  /// [configuration](#state.EditorStateConfig.extensions) with a
  /// new configuration derived from the given extension. Previously
  /// replaced extensions are reset.
  full?: Extension,
  /// When given, this extension is appended to the current
  /// configuration.
  append?: Extension,
  /// Any other properties _replace_ extensions with the
  /// [tag](#state.tagExtension) corresponding to their property
  /// name. (Note that, though TypeScript can't express this yet,
  /// properties may also be symbols.)
  ///
  /// This causes the current configuration to be updated by
  /// dropping the extensions previous associated with the tag (if
  /// any) and replacing them with the given extension.
  [tag: string]: Extension | undefined
}

/// Changes to the editor state are grouped into transactions.
/// Typically, a user action creates a single transaction, which may
/// contain any number of document changes, may change the selection,
/// or have other effects. Create a transaction by calling
/// [`EditorState.update`](#state.EditorState.update).
export class Transaction {
  /// @internal
  _doc: Text | null = null
  /// @internal
  _state: EditorState | null = null

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
    /// @internal
    readonly annotations: readonly Annotation<any>[],
    /// Holds an object when this transaction
    /// [reconfigures](#state.ReconfigurationSpec) the state.
    readonly reconfigure: ReconfigurationSpec | undefined,
    /// Whether the selection should be scrolled into view after this
    /// transaction is dispatched.
    readonly scrollIntoView: boolean
  ) {
    if (selection) checkSelection(selection, changes.newLength)
    if (!annotations.some((a: Annotation<any>) => a.type == Transaction.time))
      this.annotations = annotations.concat(Transaction.time.of(Date.now()))
  }

  /// The new document produced by the transaction. (Mostly exposed so
  /// that [transaction filters](#state.EditorState^transactionFilter)
  /// can look at the new document without forcing an entire new state
  /// to be computed by accessing
  /// [`.state`](#state.Transaction.state).
  get newDoc() {
    return this._doc || (this._doc = this.changes.apply(this.startState.doc))
  }

  /// The new selection produced by the transaction. If
  /// [`this.selection`](#state.Transaction.selection) is undefined,
  /// this will [map](#state.EditorSelection.map) the start state's
  /// current selection through the changes made by the transaction.
  get newSelection() {
    return this.selection || this.startState.selection.map(this.changes)
  }

  /// The new state created by the transaction.
  get state() {
    if (!this._state) this.startState.applyTransaction(this)
    return this._state!
  }

  /// Get the value of the given annotation type, if any.
  annotation<T>(type: AnnotationType<T>): T | undefined {
    for (let ann of this.annotations) if (ann.type == type) return ann.value
    return undefined
  }

  /// Indicates whether the transaction changed the document.
  get docChanged(): boolean { return !this.changes.empty }

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

type ResolvedSpec = {
  changes: ChangeSet,
  selection: EditorSelection | undefined,
  effects: readonly StateEffect<any>[],
  annotations: readonly Annotation<any>[],
  scrollIntoView: boolean,
  reconfigure: ReconfigurationSpec | undefined
}

function mergeTransaction(a: ResolvedSpec, b: ResolvedSpec, sequential: boolean): ResolvedSpec {
  let mapForA, mapForB, changes
  if (sequential) {
    mapForA = b.changes
    mapForB = ChangeSet.empty(b.changes.length)
    changes = a.changes.compose(b.changes)
  } else {
    mapForA = b.changes.map(a.changes)
    mapForB = a.changes.mapDesc(b.changes, true)
    changes = a.changes.compose(mapForA)
  }
  return {
    changes,
    selection: b.selection ? b.selection.map(mapForB) : a.selection?.map(mapForA),
    effects: StateEffect.mapEffects(a.effects, mapForA).concat(StateEffect.mapEffects(b.effects, mapForB)),
    annotations: a.annotations.length ? a.annotations.concat(b.annotations) : b.annotations,
    scrollIntoView: a.scrollIntoView || b.scrollIntoView,
    reconfigure: !b.reconfigure ? a.reconfigure : b.reconfigure.full || !a.reconfigure ? b.reconfigure
      : Object.assign({}, a.reconfigure, b.reconfigure)
  }
}

function resolveTransactionInner(state: EditorState, spec: TransactionSpec, docSize: number): ResolvedSpec {
  let reconf = spec.reconfigure
  if (reconf && reconf.append) {
    reconf = Object.assign({}, reconf)
    let tag = typeof Symbol == "undefined" ? "__append" + Math.floor(Math.random() * 0xffffffff) : Symbol("appendConf")
    reconf[tag as string] = reconf.append
    reconf.append = undefined
  }
  let sel = spec.selection
  return {
    changes: spec.changes instanceof ChangeSet ? spec.changes
      : ChangeSet.of(spec.changes || [], docSize, state.facet(EditorState.lineSeparator)),
    selection: sel && (sel instanceof EditorSelection ? sel : EditorSelection.single(sel.anchor, sel.head)),
    effects: !spec.effects ? none : Array.isArray(spec.effects) ? spec.effects : [spec.effects],
    annotations: !spec.annotations ? none : Array.isArray(spec.annotations) ? spec.annotations : [spec.annotations],
    scrollIntoView: !!spec.scrollIntoView,
    reconfigure: reconf
  }
}

export function resolveTransaction(state: EditorState, specs: readonly TransactionSpec[], filter: boolean): Transaction {
  let s = resolveTransactionInner(state, specs.length ? specs[0] : {}, state.doc.length)
  if (specs.length && specs[0].filter === false) filter = false
  for (let i = 1; i < specs.length; i++) {
    if (specs[i].filter === false) filter = false
    let seq = !!specs[i].sequential
    s = mergeTransaction(s, resolveTransactionInner(state, specs[i], seq ? s.changes.newLength : state.doc.length), seq)
  }
  let tr = new Transaction(state, s.changes, s.selection, s.effects, s.annotations, s.reconfigure, s.scrollIntoView)
  return filter ? filterTransaction(tr) : tr
}

// Finish a transaction by applying filters if necessary.
function filterTransaction(tr: Transaction) {
  let state = tr.startState

  // Change filters
  let result: boolean | readonly number[] = true
  for (let filter of state.facet(changeFilter)) {
    let value = filter(tr)
    if (value === false) { result = false; break }
    if (Array.isArray(value)) result = result === true ? value : joinRanges(result, value)
  }
  if (result !== true) {
    let changes, back
    if (result === false) {
      back = tr.changes.invertedDesc
      changes = ChangeSet.empty(state.doc.length)
    } else {
      let filtered = tr.changes.filter(result)
      changes = filtered.changes
      back = filtered.filtered.invertedDesc
    }
    tr = new Transaction(state, changes, tr.selection && tr.selection.map(back),
                         StateEffect.mapEffects(tr.effects, back),
                         tr.annotations, tr.reconfigure, tr.scrollIntoView)
  }

  // Transaction filters
  let filters = state.facet(transactionFilter)
  for (let i = filters.length - 1; i >= 0; i--) {
    let filtered = filters[i](tr)
    if (filtered instanceof Transaction) tr = filtered
    else if (Array.isArray(filtered) && filtered.length == 1 && filtered[0] instanceof Transaction) tr = filtered[0]
    else tr = resolveTransaction(state, Array.isArray(filtered) ? filtered : [filtered], false)
  }
  return tr
}

const none: readonly any[] = []
