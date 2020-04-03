import {Text} from "@codemirror/next/text"
import {allowMultipleSelections, changeFilter, selectionFilter} from "./extension"
import {EditorState} from "./state"
import {EditorSelection, SelectionRange, checkSelection} from "./selection"
import {Change, ChangeSet, Mapping, MapMode} from "./change"
import {Extension, ExtensionGroup} from "./facet"

let annotationID = 0

/// Annotations are tagged values that are used to add metadata to
/// transactions in an extensible way. They should be used to model
/// things that effect the entire transaction (such as its [time
/// stamp](#state.Transaction^time) or information about its
/// [origin](#state.Transaction^userEvent)). For effects that happen
/// _alongside_ the other changes made by the transaction, [state
/// effects](#state.StateEffect) are more appropriate.
export class Annotation<T> {
  /// @internal
  id = annotationID++

  private constructor() {}

  /// Define a new type of annotation.
  static define<T>() { return new Annotation<T>() }
}

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

const scrollIntoView = Annotation.define<boolean>()

class MapRef {
  constructor(readonly tr: Transaction,
              readonly index: number) {}

  mapPos(pos: number, bias: number = -1, mode: MapMode = MapMode.Simple): number {
    return this.tr.changes.mapInner(pos, bias, mode, this.index, this.tr.changes.length)
  }
}

/// Changes to the editor state are grouped into transactions.
/// Usually, a user action creates a single transaction, which may
/// contain zero or more document changes. Create a transaction by
/// calling [`EditorState.t`](#state.EditorState.t).
///
/// Transactions are mutable, and usually built up piece by piece with
/// updating methods and method chaining (most methods return the
/// transaction itself). Once they are
/// [applied](#state.Transaction.apply), they can't be updated
/// anymore.
export class Transaction {
  /// The document changes made by this transaction.
  changes: ChangeSet = ChangeSet.empty
  /// The document versions after each of the changes.
  docs: Text[] = []
  /// The selection at the end of the transaction.
  selection: EditorSelection
  /// The effects stored in this transaction
  /// ([mapped](#state.StateEffect.map) forward to the end of the
  /// transaction).
  effects: StateEffect<any>[] = []
  private annotations: {[id: number]: any} = Object.create(null)
  private selectionSetAt: null | {selection: EditorSelection, at: number} = null
  /// @internal
  reconfigureData: {base: Extension, replaced: Map<ExtensionGroup, Extension>} | null = null
  private state: EditorState | null = null

  /// @internal
  constructor(
    /// The state from which the transaction starts.
    readonly startState: EditorState,
    time: number = Date.now()
  ) {
    this.selection = startState.selection
    this.annotations[Transaction.time.id] = time
  }

  /// The document at the end of the transaction.
  get doc(): Text {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  /// Add annotations to this transaction. Annotations can provide
  /// additional information about the transaction.
  annotate<T>(annotation: Annotation<T>, value: T): Transaction {
    this.ensureOpen()
    this.annotations[annotation.id] = value
    return this
  }

  /// Get the value of the given annotation type, if any.
  annotation<T>(annotation: Annotation<T>): T | undefined {
    return this.annotations[annotation.id]
  }

  /// Add a [state effect](#state.StateEffect) to this transaction.
  effect(effect: StateEffect<any> | StateEffectType<null>) {
    this.ensureOpen()
    this.effects.push(effect instanceof StateEffect ? effect : effect.of(null))
    return this
  }

  /// Add a change, or an array of changes, to this transaction. Like
  /// with [`replace`](#state.Transaction.replace), such a change may
  /// be influenced by [change
  /// filters](#state.EditorState^changeFilter).
  ///
  /// When an array is given, all changes are interpreted as pointing
  /// at positions in the _current_ document. Note that this differs
  /// from calling this method on the changes one at a time, which
  /// would interpret later changes to point into positions in the
  /// documents produced by previous changes.
  change(change: Change | readonly Change[]): Transaction {
    this.ensureOpen()
    let changes = Array.isArray(change) ? change : [change]
    let startIndex = this.changes.length
    for (let change of this.filterChanges(changes)) {
      if (change.from == change.to && change.length == 0) continue
      if (change.from < 0 || change.to < change.from || change.to > this.doc.length)
        throw new RangeError(`Invalid change ${change.from} to ${change.to}`)
      this.docs.push(change.apply(this.doc))
      this.changes = this.changes.append(change)
    }
    let mapping = this.changes.partialMapping(startIndex)
    this.updateSelection(this.selection.map(mapping))
    this.mapEffects(mapping)
    return this
  }

  private mapEffects(mapping: Mapping) {
    for (let i = 0; i < this.effects.length; i++) {
      let mapped = this.effects[i].map(mapping)
      if (!mapped) this.effects.splice(i--, 1)
      else this.effects[i] = mapped
    }
  }

  /// Add a change to this transaction, bypassing the
  /// [`changeFilter`](#state.EditorState^changeFilter) facet. You
  /// usually do not need this, and it might sabotage the behavior of
  /// some extensions, but in some cases, such as applying remote
  /// collaborative changes, it is appropriate.
  ///
  /// If `mirror` is given, it should be the index (in
  /// `this.changes.changes`) at which the mirror image of this change
  /// sits.
  changeNoFilter(change: Change, mirror?: number): Transaction {
    this.changes = this.changes.append(change, mirror)
    this.docs.push(change.apply(this.doc))
    let at = this.selectionSetAt
    this.updateSelection(at ? at.selection.map(this.changes.partialMapping(at.at))
                         : this.startState.selection.map(this.changes))
    this.mapEffects(change)
    return this
  }

  private filterChanges(changes: Change[]) {
    let filters = this.startState.facet(changeFilter)
    for (let i = filters.length - 1; i >= 0; i--) {
      for (let j = 0; j < changes.length;) {
        let result = filters[i](changes[j], this.startState, this.changes)
        if (result && !(result.length == 1 && result[0] == changes[j])) {
          changes.splice(j, 1, ...result)
          j += result.length
        } else {
          j++
        }
      }
    }
    for (let i = 1; i < changes.length; i++) {
      let mapped = changes[i].map(new ChangeSet(changes.slice(0, i)))
      if (mapped) changes[i] = mapped
      else changes.splice(i--, 1)
    }
    return changes
  }

  /// Indicates whether the transaction changed the document.
  get docChanged(): boolean {
    return this.changes.length > 0
  }

  /// Add a change replacing the given document range with the given
  /// content. Note that, due to [change
  /// filters](#state.EditorState^changeFilter), the change may not go
  /// exactly as you provide it, so you should use position mapping,
  /// rather than hard coded calculations, to compute positions after
  /// the change.
  replace(from: number, to: number, text: string | readonly string[]): Transaction {
    return this.change(new Change(from, to, typeof text == "string" ? this.startState.splitLines(text) : text))
  }

  /// Replace all selection ranges with the given content.
  replaceSelection(text: string | readonly string[]): Transaction {
    let content = typeof text == "string" ? this.startState.splitLines(text) : text
    return this.forEachRange(range => {
      let ref = this.mapRef()
      this.replace(range.from, range.to, content)
      return new SelectionRange(ref.mapPos(range.to, 1))
    })
  }

  /// Run the given function for each selection range. The method will
  /// map the ranges to reflect deletions/insertions that happen
  /// before them. At the end, set the new selection to the ranges
  /// returned by the function (again, automatically mapped to for
  /// changes that happened after them).
  forEachRange(f: (range: SelectionRange, tr: Transaction) => SelectionRange): Transaction {
    let sel = this.selection, start = this.changes.length, newRanges: SelectionRange[] = []
    for (let range of sel.ranges) {
      let before = this.changes.length
      let result = f(range.map(this.changes.partialMapping(start)), this)
      if (this.changes.length > before) {
        let mapping = this.changes.partialMapping(before)
        for (let i = 0; i < newRanges.length; i++) newRanges[i] = newRanges[i].map(mapping)
      }
      newRanges.push(result)
    }
    return this.setSelection(EditorSelection.create(newRanges, sel.primaryIndex))
  }

  /// Update the selection.
  setSelection(selection: EditorSelection): Transaction
  setSelection(anchor: number, head?: number): Transaction
  setSelection(selection: EditorSelection | number, head?: number): Transaction {
    this.ensureOpen()
    if (typeof selection == "number") selection = EditorSelection.single(selection, head)
    if (!this.startState.facet(allowMultipleSelections)) selection = selection.asSingle()
    checkSelection(selection, this.doc)
    this.updateSelection(selection)
    this.selectionSetAt = {selection, at: this.changes.length}
    return this
  }

  private updateSelection(selection: EditorSelection) {
    for (let filters = this.startState.facet(selectionFilter), i = filters.length - 1; i >= 0; i--)
      selection = filters[i](selection, this.startState, this.changes)
    this.selection = selection
  }

  /// Tells you whether this transaction explicitly sets a new
  /// selection (as opposed to just mapping the selection through
  /// changes).
  get selectionSet(): boolean {
    return !!this.selectionSetAt
  }

  /// Set a flag on this transaction that indicates that the editor
  /// should scroll the selection into view after applying it.
  scrollIntoView(): Transaction {
    return this.annotate(scrollIntoView, true)
  }

  /// Query whether the selection should be scrolled into view after
  /// applying this transaction.
  get scrolledIntoView(): boolean {
    return !!this.annotation(scrollIntoView)
  }

  /// Provice new content for a given [extension
  /// group](#state.ExtensionGroup) in the current configuration. (If
  /// the group isn't present in the configuration, this will not have
  /// any effect.)
  replaceExtension(group: ExtensionGroup, content: Extension) {
    this.ensureOpen()
    if (!this.reconfigureData) {
      let replaced = new Map<ExtensionGroup, Extension>()
      this.startState.config.replacements.forEach((ext, group) => replaced.set(group, ext))
      this.reconfigureData = {base: this.startState.config.source, replaced}
    }
    this.reconfigureData.replaced.set(group, content)
    return this
  }

  /// Move to an entirely new state configuration.
  reconfigure(extension: Extension) {
    this.ensureOpen()
    this.reconfigureData = {base: extension, replaced: new Map}
    return this
  }

  /// Indicates whether the transaction reconfigures the state.
  get reconfigured(): boolean {
    return this.reconfigureData != null
  }

  private ensureOpen() {
    if (this.state) throw new Error("Transactions may not be modified after being applied")
  }

  /// Apply this transaction, computing a new editor state. May be
  /// called multiple times (the result is cached). The transaction
  /// cannot be further modified after this has been called.
  apply(): EditorState {
    return this.state || (this.state = this.startState.applyTransaction(this))
  }

  /// Create a set of changes that undo the changes made by this
  /// transaction.
  invertedChanges(): ChangeSet<Change> {
    if (!this.changes.length) return ChangeSet.empty
    let changes: Change[] = [], set = this.changes
    for (let i = set.length - 1; i >= 0; i--)
      changes.push(set.changes[i].invert(i == 0 ? this.startState.doc : this.docs[i - 1]))
    return new ChangeSet(changes, set.mirror.length ? set.mirror.map(i => set.length - i - 1) : set.mirror)
  }

  /// Returns a [position mapping](#state.Mapping) that can map
  /// positions in this transaction's _current_ document forward to
  /// later documents, when more changes have happened. (This differs
  /// from mapping through the transaction's `changes` property in
  /// that that always maps through all changes in the transaction,
  /// whereas this only maps through changes added since the ref was
  /// created.)
  mapRef(): Mapping { return new MapRef(this, this.changes.length) }

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
