import {Text} from "@codemirror/next/text"
import {ChangeSet, ChangeSpec, DefaultSplit} from "./change"
import {Tree} from "lezer-tree"
import {EditorSelection, SelectionRange, checkSelection} from "./selection"
import {Transaction, TransactionSpec, resolveTransaction} from "./transaction"
import {Syntax, IndentContext, allowMultipleSelections, globalLanguageData,
        changeFilter, transactionFilter} from "./extension"
import {Configuration, Facet, Extension, StateField, SlotStatus, ensureAddr, getAddr} from "./facet"
import {CharCategory, makeCategorizer} from "./charcategory"

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
  /// [Extension(s)](#state.Extension) to associate with this state.
  extensions?: Extension
}

/// The editor state class is a persistent (immutable) data structure.
/// To update a state, you [create](#state.EditorState.update) a
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
    if (tr && !tr.reconfigure) {
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
    // Fill in the computed state immediately, so that further queries
    // for it made during the update return this state
    if (tr) tr._state = this
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

  /// Create a [transaction](#state.Transaction) that updates this
  /// state. Any number of [transaction specs](#state.TransactionSpec)
  /// can be passed. The [changes](#state.TransactionSpec.changes) (if
  /// any) of each spec are assumed to start in the _current_ document
  /// (not the document produced by previous specs), and its
  /// [selection](#state.TransactionSpec.selection) and
  /// [effects](#state.TransactionSpec.effects) are assumed to refer
  /// to the document created by its _own_ changes. The resulting
  /// transaction contains the combined effect of all the different
  /// specs. For things like
  /// [selection](#state.TransactionSpec.selection) or
  /// [reconfiguration](#state.TransactionSpec.reconfigure), later
  /// specs take precedence over earlier ones.
  update(...specs: readonly TransactionSpec[]): Transaction {
    return resolveTransaction(this, specs, true)
  }

  /// @internal
  applyTransaction(tr: Transaction) {
    let conf = this.config
    if (tr.reconfigure)
      conf = Configuration.resolve(tr.reconfigure.full || conf.source,
                                   Object.assign(conf.replacements, tr.reconfigure, {full: undefined}),
                                   this)
    new EditorState(conf, tr.newDoc, tr.newSelection, tr)
  }

  /// Create a [transaction](#state.Transaction) that replaces every
  /// selection range with the given content.
  replaceSelection(text: string | Text) {
    if (typeof text == "string") text = this.toText(text)
    return this.changeByRange(range => ({changes: {from: range.from, to: range.to, insert: text},
                                         range: EditorSelection.cursor(range.from + text.length)}))
  }

  /// Create a set of changes and a new selection by running the given
  /// function for each range in the active selection. The function
  /// can return an optional set of changes (in the coordinate space
  /// of the start document), plus an updated range (in the coordinate
  /// space of the document produced by the call's own changes). This
  /// method will merge all the changes and ranges into a single
  /// changeset and selection, and return it as a [transaction
  /// spec](#state.StrictTransactionSpec), which can be passed to
  /// [`update`](#state.EditorState.update).
  changeByRange(f: (range: SelectionRange) => {changes?: ChangeSpec, range: SelectionRange}): {
    changes: ChangeSet,
    selection: EditorSelection
  } {
    let sel = this.selection
    let result1 = f(sel.ranges[0])
    let changes = this.changes(result1.changes), ranges = [result1.range]
    for (let i = 1; i < sel.ranges.length; i++) {
      let result = f(sel.ranges[i])
      let newChanges = this.changes(result.changes), newMapped = newChanges.map(changes)
      for (let j = 0; j < i; j++) ranges[j] = ranges[j].map(newMapped)
      ranges.push(result.range.map(changes.mapDesc(newChanges, true)))
      changes = changes.compose(newMapped)
    }
    return {
      changes,
      selection: EditorSelection.create(ranges, sel.primaryIndex)
    }
  }

  /// Create a [change set](#state.ChangeSet) from the given change
  /// description, taking the state's document length and line
  /// separator into account.
  changes(spec: ChangeSpec = []) {
    if (spec instanceof ChangeSet) return spec
    return ChangeSet.of(spec, this.doc.length, this.facet(EditorState.lineSeparator))
  }

  /// Using the state's [line
  /// separator](#state.EditorState^lineSeparator), create a
  /// [`Text`](#text.Text) instance from the given string.
  toText(string: string): Text {
    return Text.of(string.split(this.facet(EditorState.lineSeparator) || DefaultSplit))
  }

  /// Return the given range of the document as a string.
  sliceDoc(from = 0, to = this.doc.length) {
    return this.doc.sliceString(from, to, this.lineBreak)
  }

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
      doc: this.sliceDoc(),
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
    checkSelection(selection, doc.length)
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
  /// (highest-precedence) value of the facet is used. If no value is
  /// given, this defaults to 4.
  static tabSize = Facet.define<number, number>({
    combine: values => values.length ? values[0] : 4
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

  /// Get the proper [line-break](#state.EditorState^lineSeparator)
  /// string for this state.
  get lineBreak() { return this.facet(EditorState.lineSeparator) || "\n" }

  /// Facet for overriding the unit by which indentation happens.
  /// Should be a string consisting either entirely of spaces or
  /// entirely of tabs. When not set, this defaults to 2 spaces.
  static indentUnit = Facet.define<string, string>({
    combine: values => {
      if (!values.length) return "  "
      if (!/^(?: +|\t+)$/.test(values[0])) throw new Error("Invalid indent unit: " + JSON.stringify(values[0]))
      return values[0]
    }
  })

  /// The _column width_ of an indent unit in the document. Determined
  /// by the [`indentUnit`](#state.EditorState^indentUnit) facet, and
  /// [`tabSize`](#state.EditorState^tabSize) when that contains tabs.
  get indentUnit() {
    let unit = this.facet(EditorState.indentUnit)
    return unit.charCodeAt(0) == 9 ? this.tabSize * unit.length : unit.length
  }

  /// Whether indentation should use tabs. Will be true when the
  /// [`indentUnit`](#state.EditorState^indentUnit) facet contains
  /// tabs.
  get indentWithTabs() { return this.facet(EditorState.indentUnit).charCodeAt(0) == 9 }

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

  /// Return a function that can categorize strings (expected to
  /// represent a single [grapheme cluster](#text.nextClusterBreak))
  /// into one of:
  ///
  ///  - Word (contains an alphanumeric character or a character
  ///    explicitly listed in the local language's `"wordChars"`
  ///    language data, which should be a string)
  ///  - Space (contains only whitespace)
  ///  - Other (anything else)
  charCategorizer(at: number): (char: string) => CharCategory {
    return makeCategorizer(this.languageDataAt<string>("wordChars", at).join(""))
  }

  /// Get the syntax tree for this state, which is the current
  /// (possibly incomplete) parse tree of the [syntax](#state.Syntax)
  /// with the highest precedence, or the empty tree if there is no
  /// syntax available.
  get tree() {
    let syntax = this.facet(EditorState.syntax)
    return syntax.length ? syntax[0].getTree(this) : Tree.empty
  }

  /// A facet used to register [language
  /// data](#state.EditorState.languageDataAt) that should apply
  /// throughout the document, regardless of language.
  static globalLanguageData = globalLanguageData

  /// Find the values for a given language data field, either provided
  /// by the [syntax](#state.languageData) or through the
  /// [`addLanguageData`](#state.EditorState^addLanguageData) facet,
  /// for the [document type](#state.Syntax.docNodeTypeAt) at the
  /// given position. Values provided by the facet, in precedence
  /// order, will appear before those provided by the syntax.
  languageDataAt<T>(name: string, pos: number): readonly T[] {
    let values: T[] = []
    let syntax = this.facet(EditorState.syntax)
    for (let i = syntax.length ? 0 : 1; i < 2; i++) {
      let source = this.facet(i ? globalLanguageData : syntax[0].languageDataFacetAt(this, pos))
      for (let obj of source) if (Object.prototype.hasOwnProperty.call(obj, name))
        values.push(obj[name])
    }
    return values
  }

  /// A facet that registers a code folding service. When called with
  /// the extent of a line, such a function should return a range
  /// object when a foldable that starts on that line (but continues
  /// beyond it), if one can be found.
  static foldable = Facet.define<(state: EditorState, lineStart: number, lineEnd: number) => ({from: number, to: number} | null)>()

  /// Facet used to register change filters, which are called for each
  /// transaction (unless explicitly
  /// [disabled](#state.TransactionSpec.filter)), and can suppress
  /// part of the transaction's changes.
  ///
  /// Such a function can return `true` to indicate that it doesn't
  /// want to do anything, `false` to completely stop the changes in
  /// the transaction, or a set of ranges in which changes should be
  /// suppressed. Such ranges are represented as an array of numbers,
  /// with each pair of two number indicating the start and end of a
  /// range. So for example `[10, 20, 100, 110]` suppresses changes
  /// between 10 and 20, and between 100 and 110.
  static changeFilter = changeFilter

  /// Facet used to register a hook that gets a chance to update or
  /// replace transaction specs before they are applied. This will
  /// only be applied for transactions that don't have
  /// [`filter`](#state.TransactionSpec.filter) set to `false`. You
  /// can either return a single (possibly the input transaction), or
  /// an array of specs (which will be combined in the same way as the
  /// arguments to [`EditorState.update`](#state.EditorState.update)).
  ///
  /// When possible, it is recommended to avoid accessing
  /// [`Transaction.state`](#state.Transaction.state) in a filter,
  /// since it will force creation of a state that will then be
  /// discarded again, if the transaction is actually filtered.
  ///
  /// (This functionality should be used with care. Indiscriminately
  /// modifying transaction is likely to break something or degrade
  /// the user experience.)
  static transactionFilter = transactionFilter
}
