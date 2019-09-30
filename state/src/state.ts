import {Text} from "../../text"
import {EditorSelection} from "./selection"
import {Transaction} from "./transaction"
import {Extension, Configuration, Behavior} from "../../extension"
import {extendState, Syntax, stateField, StateField, allowMultipleSelections} from "./extension"

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

const DEFAULT_INDENT_UNIT = 2, DEFAULT_TABSIZE = 4, DEFAULT_SPLIT = /\r\n?|\n/

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
  joinLines(text: ReadonlyArray<string>): string { return text.join(this.behavior(EditorState.lineSeparator) || "\n") }

  /// Split a string into lines using the current [line
  /// separator](#state.EditorStateConfig.lineSeparator).
  splitLines(text: string): string[] { return text.split(this.behavior(EditorState.lineSeparator) || DEFAULT_SPLIT) }

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
      : Text.of((config.doc || "").split(configuration.getBehavior(EditorState.lineSeparator) || DEFAULT_SPLIT))
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
  static allowMultipleSelections = allowMultipleSelections

  /// Behavior that defines a way to query for automatic indentation
  /// depth at the start of a given line.
  static indentation = extendState.behavior<(state: EditorState, pos: number) => number>()

  /// Configures the tab size to use in this state. The first
  /// (highest-precedence) value of the behavior is used.
  static tabSize = extendState.behavior<number, number>({
    combine: values => values.length ? values[0] : DEFAULT_TABSIZE
  })

  /// The size of a tab in the document, determined by the
  /// [`tabSize`](#state.EditorState^tabSize) behavior.
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

  /// The size of an indent unit in the document. Determined by the
  /// [`indentUnit`](#state.EditorState^indentUnit) behavior.
  get indentUnit() { return this.behavior(EditorState.indentUnit) }

  /// Behavior that registers a parsing service for the state.
  static syntax = extendState.behavior<Syntax>()
}
