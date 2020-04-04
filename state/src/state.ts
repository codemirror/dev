import {Text} from "@codemirror/next/text"
import {Tree} from "lezer-tree"
import {EditorSelection, checkSelection} from "./selection"
import {Transaction} from "./transaction"
import {Syntax, IndentContext, allowMultipleSelections, languageData, addLanguageData,
        changeFilter, selectionFilter} from "./extension"
import {Configuration, Facet, Extension, StateField, SlotStatus, ensureAddr, getAddr} from "./facet"

/// Options passed when [creating](#state.EditorState^create) an
/// editor state.
export interface EditorStateConfig {
  /// The initial document. Defaults to an empty document. Can be
  /// provided either as a plain string (which will be split into
  /// lines according to the value of the [`lineSeparator`
  /// facet](#state.EditorState^lineSeparator)), or an instance of
  /// the [`Text`](#text.Text) class (which is what the state will use
  /// to represent the document).
  doc?: string | Text
  /// The starting selection. Defaults to a cursor at the very start
  /// of the document.
  selection?: EditorSelection | {anchor: number, head?: number}
  /// [State](#state.EditorState^extend) or
  /// [view](#view.EditorView^extend) extensions to associate with
  /// this state.
  extensions?: Extension
}

const DefaultIndentUnit = 2, DefaultTabsize = 4, DefaultSplit = /\r\n?|\n/

/// The editor state class is a persistent (immutable) data structure.
/// To update a state, you [create](#state.EditorState.t) and
/// [apply](#state.Transaction.apply) a
/// [transaction](#state.Transaction), which produces a _new_ state
/// instance, without modifying the original object.
///
/// As such, _never_ mutate properties of a state directly. That'll
/// just break things.
export class EditorState {
  /// @internal
  readonly values: any[]
  /// @internal
  readonly status: SlotStatus[]
  /// @internal
  applying: null | Transaction = null

  /// @internal
  constructor(
    /// @internal
    readonly config: Configuration,
    /// The current document.
    readonly doc: Text,
    /// The current selection.
    readonly selection: EditorSelection,
    tr: Transaction | null = null
  ) {
    this.status = config.statusTemplate.slice()
    if (tr && !tr.reconfigured) {
      this.values = tr.startState.values.slice()
    } else {
      this.values = config.dynamicSlots.map(_ => null)
      // Copy over old values for shared facets/fields if this is a reconfigure
      if (tr) for (let id in config.address) {
        let cur = config.address[id], prev = tr.startState.config.address[id]
        if (prev != null && (cur & 1) == 0) this.values[cur >> 1] = getAddr(tr.startState, prev)
      }
    }

    this.applying = tr
    for (let i = 0; i < this.config.dynamicSlots.length; i++) ensureAddr(this, i << 1)
    this.applying = null
  }

  /// Retrieve the value of a [state field](#state.StateField). Throws
  /// an error when the state doesn't have that field, unless you pass
  /// `false` as second parameter.
  field<T>(field: StateField<T>): T
  field<T>(field: StateField<T>, require: false): T | undefined
  field<T>(field: StateField<T>, require: boolean = true): T | undefined {
    let addr = this.config.address[field.id]
    if (addr == null) {
      if (require) throw new RangeError("Field is not present in this state")
      return undefined
    }
    ensureAddr(this, addr)
    return getAddr(this, addr)
  }

  /// Start a new transaction from this state. When not given, the
  /// timestamp defaults to
  /// [`Date.now()`](https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Date/now).
  t(timestamp?: number): Transaction {
    return new Transaction(this, timestamp)
  }

  /// Join an array of lines using the state's [line
  /// separator](#state.EditorState^lineSeparator).
  joinLines(text: readonly string[]): string { return text.join(this.facet(EditorState.lineSeparator) || "\n") }

  /// Split a string into lines using the state's [line
  /// separator](#state.EditorState^lineSeparator).
  splitLines(text: string): string[] { return text.split(this.facet(EditorState.lineSeparator) || DefaultSplit) }

  /// Get the value of a state [facet](#state.Facet).
  facet<Output>(facet: Facet<any, Output>): Output {
    let addr = this.config.address[facet.id]
    if (addr == null) return facet.default
    ensureAddr(this, addr)
    return getAddr(this, addr)
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

  /// @internal
  applyTransaction(tr: Transaction): EditorState {
    let reconf = tr.reconfigureData, config = reconf ? Configuration.resolve(reconf.base, reconf.replaced, this): this.config
    return new EditorState(config, tr.doc, tr.selection, tr)
  }

  /// Create a new state. You'll usually only need this when
  /// initializing an editor—updated states are created by applying
  /// transactions.
  static create(config: EditorStateConfig = {}): EditorState {
    let configuration = Configuration.resolve(config.extensions || [])
    let doc = config.doc instanceof Text ? config.doc
      : Text.of((config.doc || "").split(configuration.staticFacet(EditorState.lineSeparator) || DefaultSplit))
    let selection = !config.selection ? EditorSelection.single(0)
      : config.selection instanceof EditorSelection ? config.selection
      : EditorSelection.single(config.selection.anchor, config.selection.head)
    checkSelection(selection, doc)
    if (!configuration.staticFacet(allowMultipleSelections)) selection = selection.asSingle()
    return new EditorState(configuration, doc, selection)
  }

  /// A facet that, when enabled, causes the editor to allow multiple
  /// ranges to be selected. You should probably not use this
  /// directly, but let a plugin like
  /// [multiple-selections](#multiple-selections) handle it (which
  /// also makes sure the selections are visible in the view).
  static allowMultipleSelections = allowMultipleSelections

  /// Facet that defines a way to query for automatic indentation
  /// depth at the start of a given line.
  static indentation = Facet.define<(context: IndentContext, pos: number) => number>()

  /// Configures the tab size to use in this state. The first
  /// (highest-precedence) value of the facet is used.
  static tabSize = Facet.define<number, number>({
    combine: values => values.length ? values[0] : DefaultTabsize
  })

  /// The size (in columns) of a tab in the document, determined by
  /// the [`tabSize`](#state.EditorState^tabSize) facet.
  get tabSize() { return this.facet(EditorState.tabSize) }

  /// The line separator to use. By default, any of `"\n"`, `"\r\n"`
  /// and `"\r"` is treated as a separator when splitting lines, and
  /// lines are joined with `"\n"`.
  ///
  /// When you configure a value here, only that precise separator
  /// will be used, allowing you to round-trip documents through the
  /// editor without normalizing line separators.
  static lineSeparator = Facet.define<string, string | undefined>({
    combine: values => values.length ? values[0] : undefined,
    static: true
  })

  /// Facet for overriding the unit (in columns) by which
  /// indentation happens. When not set, this defaults to 2.
  static indentUnit = Facet.define<number, number>({
    combine: values => values.length ? values[0] : DefaultIndentUnit
  })

  /// The size of an indent unit in the document. Determined by the
  /// [`indentUnit`](#state.EditorState^indentUnit) facet.
  get indentUnit() { return this.facet(EditorState.indentUnit) }

  /// Registers translation phrases. The
  /// [`phrase`](#state.EditorState.phrase) method will look through
  /// all objects registered with this facet to find translations for
  /// its argument.
  static phrases = Facet.define<{[key: string]: string}>()

  /// Look up a translation for the given phrase (via the
  /// [`phrases`](#state.EditorState^phrases) facet), or return the
  /// original string if no translation is found.
  phrase(phrase: string): string {
    for (let map of this.facet(EditorState.phrases))
      if (Object.prototype.hasOwnProperty.call(map, phrase)) return map[phrase]
    return phrase
  }

  /// Facet that registers a parsing service for the state.
  static syntax = Facet.define<Syntax>()

  /// Get the syntax tree for this state, which is the current
  /// (possibly incomplete) parse tree of the [syntax](#state.Syntax)
  /// with the highest precedence, or the empty tree if there is no
  /// syntax available.
  get tree() {
    let syntax = this.facet(EditorState.syntax)
    return syntax.length ? syntax[0].getTree(this) : Tree.empty
  }

  /// A facet used to register extra [language
  /// data](#state.EditorState.languageDataAt) with a language. Values
  /// are objects with the target [document
  /// type](#state.Syntax.topNodeType) in their `type` property, and any
  /// associated data in other properties.
  static addLanguageData = addLanguageData

  /// Find the values for a given language data field, either provided
  /// by the [syntax](#state.languageData) or through the
  /// [`addLanguageData`](#state.EditorState^addLanguageData) facet,
  /// for the [document type](#state.Syntax.docNodeTypeAt) at the
  /// given position. Values provided by the facet, in precedence
  /// order, will appear before those provided by the syntax.
   languageDataAt<T>(name: string, pos: number): readonly T[] {
    let syntax = this.facet(EditorState.syntax)
    if (syntax.length == 0) return none
    let values: T[] | null = null
    let type = syntax[0].docNodeTypeAt(this, pos)
    for (let added of this.facet(addLanguageData)) {
      if (added.type == type && Object.prototype.hasOwnProperty.call(added, name))
        (values || (values = [])).push(added[name])
    }
    let langData = type.prop(languageData)
    if (langData && Object.prototype.hasOwnProperty.call(langData, name))
      (values || (values = [])).push(langData[name])
    return values || none
  }

  /// A facet that registers a code folding service. When called with
  /// the extent of a line, such a function should return a range
  /// object when a foldable that starts on that line (but continues
  /// beyond it), if one can be found.
  static foldable = Facet.define<(state: EditorState, lineStart: number, lineEnd: number) => ({from: number, to: number} | null)>()

  /// Facet used to register change filters, which are called for each
  /// change applied in a transaction, and can modify those changes.
  /// Such a function should return null to indicate that it doesn't
  /// want to do anything about the given change, or an array of
  /// replacement changes.
  ///
  /// Change filters are called from lower to higher precedence. When
  /// a change is replaced by a given filter, only filters with higher
  /// precedence are called on the newly produced changes.
  static changeFilter = changeFilter

  /// Facet used to register selection filters. Whenever a transaction
  /// updates its selection, such filters get a chance to replace the
  /// new selection with another one.
  static selectionFilter = selectionFilter
}

const none: any[] = []
