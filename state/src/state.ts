import {joinLines, splitLines, Text} from "../../doc/src"
import {EditorSelection} from "./selection"
import {Transaction} from "./transaction"
import {Extension, ExtensionGroup, Configuration, Behavior} from "../../extension/src/extension"
import {Tree} from "lezer-tree"

export const extendState = new ExtensionGroup<EditorState>(state => state.values)

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

const DEFAULT_INDENT_UNIT = 2, DEFAULT_TABSIZE = 4

export class EditorState {
  /// @internal
  constructor(
    /// @internal
    readonly configuration: Configuration<EditorState>,
    /// @internal
    readonly values: {[id: number]: any},
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
  field<T>(field: StateField<T>): T
  field<T>(field: StateField<T>, require: false): T | undefined
  field<T>(field: StateField<T>, require: boolean = true): T | undefined {
    let value = this.values[field.id]
    if (value === undefined && !Object.prototype.hasOwnProperty.call(this.values, field.id)) {
      if (this.behavior(stateField).indexOf(field) > -1)
        throw new RangeError("Field hasn't been initialized yet")
      if (require)
        throw new RangeError("Field is not present in this state")
      return undefined
    }
    return value
  }

  /// @internal
  applyTransaction(tr: Transaction): EditorState {
    let values = Object.create(null), configuration = tr.configuration
    let newState = new EditorState(configuration, values, tr.doc, tr.selection)
    for (let field of configuration.getBehavior(stateField)) {
      let exists = configuration == this.configuration || Object.prototype.hasOwnProperty.call(this.values, field.id)
      values[field.id] = exists ? field.apply(tr, this.values[field.id], newState) : field.init(newState)
    }
    return newState
  }

  /// Start a new transaction from this state.
  t(time?: number): Transaction {
    return new Transaction(this, time)
  }

  /// Join an array of lines using the current [line
  /// separator](#state.EditorStateConfig.lineSeparator).
  joinLines(text: ReadonlyArray<string>): string { return joinLines(text, this.behavior(EditorState.lineSeparator)) }

  /// Split a string into lines using the current [line
  /// separator](#state.EditorStateConfig.lineSeparator).
  splitLines(text: string): string[] { return splitLines(text, this.behavior(EditorState.lineSeparator)) }

  /// Get the value of a state behavior.
  behavior<Output>(behavior: Behavior<any, Output>): Output {
    return this.configuration.getBehavior(behavior, this)
  }

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
    let configuration = extendState.resolve(config.extensions || [])
    let values = Object.create(null)
    let doc = config.doc instanceof Text ? config.doc
      : Text.of(config.doc || "", configuration.getBehavior(EditorState.lineSeparator))
    let selection = config.selection || EditorSelection.single(0)
    if (!configuration.getBehavior(EditorState.allowMultipleSelections)) selection = selection.asSingle()
    let state = new EditorState(configuration, values, doc, selection)
    for (let field of state.behavior(stateField)) values[field.id] = field.init(state)
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
  static allowMultipleSelections = extendState.behavior<boolean, boolean>({
    combine: values => values.some(v => v),
    static: true
  })

  /// Behavior that defines a way to query for automatic indentation
  /// depth at the start of a given line.
  static indentation = extendState.behavior<(state: EditorState, pos: number) => number>()

  get indentation() { return this.behavior(EditorState.indentation) }

  /// Configures the tab size to use in this state. The first
  /// (highest-precedence) value of the behavior is used.
  static tabSize = extendState.behavior<number, number>({
    combine: values => values.length ? values[0] : DEFAULT_TABSIZE
  })

  get tabSize() { return this.behavior(EditorState.tabSize) }

  /// The line separator to use. By default, any of `"\n"`, `"\r\n"`
  /// and `"\r"` is treated as a separator when splitting lines, and
  /// lines are joined with `"\n"`.
  ///
  /// When you configure a value here, only that precise separator
  /// will be used, allowing you to round-trip documents through the
  /// editor without normalizing line separators.
  static lineSeparator = extendState.behavior<string, string | undefined>({
    combine: values => values.length ? values[0] : undefined,
    static: true
  })

  /// Behavior for overriding the unit by which indentation happens.
  static indentUnit = extendState.behavior<number, number>({
    combine: values => values.length ? values[0] : DEFAULT_INDENT_UNIT
  })

  get indentUnit() { return this.behavior(EditorState.indentUnit) }

  /// Behavior that registers a parsing service for the state.
  static syntax = extendState.behavior<Syntax>()
}

const stateField = extendState.behavior<StateField<any>>({static: true})

/// Parameters passed when creating a
/// [`StateField`](#state.StateField).
export interface StateFieldSpec<Value> {
  /// Creates the initial value for the field.
  init: (state: EditorState) => Value
  /// Compute a new value from the previous value and a
  /// [transaction](#state.Transaction).
  apply: (tr: Transaction, value: Value, newState: EditorState) => Value
}

/// Fields can store store information. They can be optionally
/// associated with behaviors.
export class StateField<Value> {
  /// The extension that can be used to
  /// [attach](#state.EditorStateConfig.extensions) this field to a
  /// state.
  readonly extension: Extension

  /// @internal
  readonly id = extendState.storageID()
  /// @internal
  readonly init: (state: EditorState) => Value
  /// @internal
  readonly apply: (tr: Transaction, value: Value, state: EditorState) => Value

  /// Declare a new field. The field instance is used as the
  /// [key](#state.EditorState.field) when retrieving the field's value
  /// from a state.
  constructor(spec: StateFieldSpec<Value>) {
    this.init = spec.init
    this.apply = spec.apply
    this.extension = stateField(this)
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
