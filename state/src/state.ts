import {joinLines, splitLines, Text} from "../../doc/src"
import {EditorSelection} from "./selection"
import {Transaction} from "./transaction"
import {ExtensionType, Extension, BehaviorStore} from "../../extension/src/extension"
import {Tree} from "lezer-tree"

const extendState = new ExtensionType

class Configuration {
  constructor(
    readonly behavior: BehaviorStore,
    readonly fields: ReadonlyArray<StateField<any>>,
    readonly multipleSelections: boolean,
    readonly tabSize: number,
    readonly lineSeparator: string | null) {}

  static create(config: EditorStateConfig): Configuration {
    let behavior = extendState.resolve(config.extensions || [])
    return new Configuration(
      behavior,
      behavior.get(stateFieldBehavior),
      behavior.get(EditorState.allowMultipleSelections).some(x => x),
      behavior.get(EditorState.tabSize)[0] || 4,
      behavior.get(EditorState.lineSeparator)[0] || null)
  }
}

/// Options passed when [creating](#state.EditorState^create) an
/// editor state.
export interface EditorStateConfig {
  /// The initial document. Defaults to an empty document.
  doc?: string | Text
  /// The starting selection. Defaults to a cursor at the very start
  /// of the document.
  selection?: EditorSelection
  /// State and view extensions to associate with this state. The view
  /// extensions only take effect when the state is put into an editor
  /// view.
  extensions?: ReadonlyArray<Extension>
}

const DEFAULT_INDENT_UNIT = 2

export class EditorState {
  /// @internal
  constructor(
    /// @internal
    readonly config: Configuration,
    private readonly fields: ReadonlyArray<any>,
    /// The current document.
    readonly doc: Text,
    /// The current selection.
    readonly selection: EditorSelection
  ) {
    for (let range of selection.ranges)
      if (range.to > doc.length) throw new RangeError("Selection points outside of document")
  }

  /// Retrieve the value of a [state field](#state.StateField). Throws
  /// an error when the state doesn't have that field, unless you pass
  /// `false` as second parameter.
  getField<T>(field: StateField<T>): T
  getField<T>(field: StateField<T>, require: false): T | undefined
  getField<T>(field: StateField<T>, require: boolean = true): T | undefined {
    let index = this.config.fields.indexOf(field)
    if (index < 0) {
      if (require) throw new RangeError("Field is not present in this state")
      else return undefined
    }
    if (index >= this.fields.length) throw new RangeError("Field hasn't been initialized yet")
    return this.fields[index]
  }

  /// @internal
  applyTransaction(tr: Transaction): EditorState {
    let fields: any[] = []
    let newState = new EditorState(this.config, fields, tr.doc, tr.selection)
    for (let i = 0; i < this.fields.length; i++)
      fields[i] = this.config.fields[i].apply(tr, this.fields[i], newState)
    return newState
  }

  /// Start a new transaction from this state.
  t(time?: number): Transaction {
    return new Transaction(this, time)
  }

  /// The current tab size.
  get tabSize(): number { return this.config.tabSize }

  /// The current value of the [`indentUnit`
  /// behavior](state.EditorState^indentUnit), or 2 if no such
  /// behavior is present.
  get indentUnit(): number {
    // FIXME precompute?
    let values = this.behavior.get(EditorState.indentUnit)
    return values.length ? values[0] : DEFAULT_INDENT_UNIT
  }

  /// Whether multiple selections are
  /// [enabled](#state.EditorState^allowMultipleSelections).
  get multipleSelections(): boolean { return this.config.multipleSelections }

  /// Join an array of lines using the current [line
  /// separator](#state.EditorStateConfig.lineSeparator).
  joinLines(text: ReadonlyArray<string>): string { return joinLines(text, this.config.lineSeparator || undefined) }

  /// Split a string into lines using the current [line
  /// separator](#state.EditorStateConfig.lineSeparator).
  splitLines(text: string): string[] { return splitLines(text, this.config.lineSeparator || undefined) }

  /// The [behavior store](#extension.BehaviorStore) associated with
  /// this state.
  get behavior() { return this.config.behavior }

  /// Convert this state to a JSON-serializable object.
  toJSON(): any {
    // FIXME plugin state serialization
    return {
      doc: this.joinLines(this.doc.sliceLines(0, this.doc.length)),
      selection: this.selection.toJSON()
    }
  }

  /// Deserialize a state from its JSON representation.
  static fromJSON(json: any, config: EditorStateConfig = {}): EditorState {
    if (!json || typeof json.doc != "string")
      throw new RangeError("Invalid JSON representation for EditorState")
    return EditorState.create({
      doc: json.doc,
      selection: EditorSelection.fromJSON(json.selection),
      extensions: config.extensions
    })
  }

  /// Create a new state.
  static create(config: EditorStateConfig = {}): EditorState {
    let $config = Configuration.create(config)
    let doc = config.doc instanceof Text ? config.doc
      : Text.of(config.doc || "", $config.lineSeparator || undefined)
    let selection = config.selection || EditorSelection.single(0)
    if (!$config.multipleSelections) selection = selection.asSingle()
    let fields: any[] = []
    let state = new EditorState($config, fields, doc, selection)
    for (let field of $config.fields) fields.push(field.init(state))
    return state
  }

  /// Reconfigure a state with a new set of extensions. This will
  /// preserve the doc and selection, and allow [state
  /// fields](#state.StateField) that appear in both the old and the
  /// new state to preserve their old value via their `reconfigure`
  /// method.
  reconfigure(extensions: readonly Extension[]) {
    // FIXME changing the line separator might involve rearranging line endings (?)
    let config = Configuration.create({extensions})
    let selection = config.multipleSelections ? this.selection : this.selection.asSingle()
    let fields: any[] = []
    let state = new EditorState(config, fields, this.doc, selection)
    for (let field of config.fields) {
      let oldIndex = this.config.fields.indexOf(field)
      fields.push(oldIndex > -1 ? field.reconfigure(state, this.fields[oldIndex]) : field.init(state))
    }
    return state
  }

  /// The [extension type](#extension.ExtensionType) for editor
  /// states.
  static extend = extendState

  /// A behavior that, when enabled, causes the editor to allow
  /// multiple ranges to be selected. You should probably not use this
  /// directly, but let a plugin like
  /// [multiple-selections](#multiple-selections) handle it (which
  /// also makes sure the selections are drawn and new selections can
  /// be created with the mouse).
  static allowMultipleSelections = extendState.behavior<boolean>()

  /// Behavior that defines a way to query for automatic indentation
  /// depth at the start of a given line.
  static indentation = extendState.behavior<(state: EditorState, pos: number) => number>()

  /// Configures the tab size to use in this state. The first
  /// (highest-precedence) value of the behavior is used.
  static tabSize = extendState.behavior<number>()

  /// The line separator to use. By default, any of `"\n"`, `"\r\n"`
  /// and `"\r"` is treated as a separator when splitting lines, and
  /// lines are joined with `"\n"`.
  ///
  /// When you configure a value here, only that precise separator
  /// will be used, allowing you to round-trip documents through the
  /// editor without normalizing line separators.
  static lineSeparator = extendState.behavior<string>()

  /// Behavior for overriding the unit by which indentation happens.
  static indentUnit = extendState.behavior<number>()

  /// Behavior that registers a parsing service for the state.
  static syntax = extendState.behavior<Syntax>()
}

const stateFieldBehavior = extendState.behavior<StateField<any>>()

/// State fields store extra information in the editor state. Because
/// this state is immutable, the values in these fields must be too.
export class StateField<T> {
  /// @internal
  readonly init: (state: EditorState) => T
  /// @internal
  readonly apply: (tr: Transaction, value: T, newState: EditorState) => T
  /// @internal
  readonly reconfigure: (state: EditorState, oldValue: T) => T
  /// The extension that can be used to
  /// [attach](#state.EditorStateConfig.extensions) this field to a
  /// state.
  readonly extension: Extension

  /// Create a new state field. The `init` function creates the
  /// initial value for the field in a newly created editor state. The
  /// `apply` function computes a new value from the previous value
  /// and a [transaction](#state.Transaction).
  ///
  /// The `reconfigure` method can be used to carry a field's value
  /// through a call to
  /// [`EditorState.reconfigure`](#state.EditorState.reconfigure). If
  /// both the old and the new configuration contain this (exact)
  /// field, it'll be called (if present) instead of `init`, to create
  /// the new field value.
  constructor({init, apply, reconfigure}: {
    init: (state: EditorState) => T,
    apply: (tr: Transaction, value: T, newState: EditorState) => T
    reconfigure?: (state: EditorState, oldValue: T) => T
  }) {
    this.init = init
    this.apply = apply
    this.reconfigure = reconfigure || init
    this.extension = stateFieldBehavior(this)
  }
}

/// This is a
/// [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
/// with an additional field that can be used to indicate you are no
/// longer interested in its result. It is used by the editor view's
/// [`waitFor`](#view.EditorView.waitFor) mechanism, which helps deal
/// with partial results (mostly from [`Syntax`](#state.Syntax)
/// queries).
export type CancellablePromise<T> = Promise<T> & {canceled?: boolean}

/// Syntax [parsing services](#state.EditorState^syntax) must provide
/// this interface.
export interface Syntax {
  /// The extension that can be used to register this service.
  extension: Extension
  /// Get a syntax tree covering at least the given range. When that
  /// can't be done quickly enough, `rest` will hold a promise that
  /// you can wait on to get the rest of the tree.
  getTree(state: EditorState, from: number, to: number): {tree: Tree, rest: CancellablePromise<Tree> | null}
  /// Get a syntax tree covering the given range, or null if that
  /// can't be done in reasonable time.
  tryGetTree(state: EditorState, from: number, to: number): Tree | null
  /// Get a syntax tree, preferably covering the given range, but less
  /// is also acceptable.
  getPartialTree(state: EditorState, from: number, to: number): Tree
}
