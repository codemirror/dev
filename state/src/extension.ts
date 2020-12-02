import {Tree, NodeProp} from "lezer-tree"
import {Line, countColumn} from "@codemirror/next/text"
import {EditorState} from "./state"
import {Transaction, TransactionSpec} from "./transaction"
import {Facet} from "./facet"

/// Subtype of [`Command`](#view.Command) that doesn't require access
/// to the actual editor view. Mostly useful to define commands that
/// can be run and tested outside of a browser environment.
export type StateCommand = (target: {state: EditorState, dispatch: (transaction: Transaction) => void}) => boolean

export const allowMultipleSelections = Facet.define<boolean, boolean>({
  combine: values => values.some(v => v),
  static: true
})

export const lineSeparator = Facet.define<string, string | undefined>({
  combine: values => values.length ? values[0] : undefined,
  static: true
})

export const changeFilter = Facet.define<(tr: Transaction) => boolean | readonly number[]>()

export const transactionFilter = Facet.define<(tr: Transaction) => TransactionSpec | readonly TransactionSpec[]>()

export const transactionExtender =
  Facet.define<(tr: Transaction) => Pick<TransactionSpec, "effects" | "annotations" | "reconfigure">>()

/// A node prop stored on a grammar's top node to indicate the facet
/// used to store [language data](#state.EditorState.languageDataAt)
/// related to that language.
export const languageDataProp = new NodeProp<Facet<{[name: string]: any}>>()

export const globalLanguageData = Facet.define<{[name: string]: any}>()

/// Syntax [parsing services](#state.EditorState^syntax) must provide
/// this interface.
export interface Syntax {
  /// Read the current syntax tree from a state. This may return an
  /// incomplete tree.
  getTree(state: EditorState): Tree

  /// Get the position up to which the current document has been
  /// parsed.
  parsePos(state: EditorState): number

  /// Get a tree that covers the document at least up to `upto`. If
  /// that involves more than `timeout` milliseconds of work, return
  /// null instead. Don't call this as a matter of course in, for
  /// example, state updates or decorating functions, since it'll make
  /// the editor unresponsive. Calling it in response to a specific
  /// user command can be appropriate.
  ensureTree(state: EditorState, upto: number, timeout?: number): Tree | null

  /// A facet through which to install [language
  /// data](#state.EditorState.languageDataAt) for this language.
  languageData: Facet<{[name: string]: any}>

  /// Return the facet that stores the language data for the given
  /// position. This'll usually be the be the grammar's own [language
  /// data](#state.Syntax.languageData), but with nested grammars it
  /// may be the data facet from some inner language.
  languageDataFacetAt(state: EditorState, pos: number): Facet<{[name: string]: any}>
}

/// Indentation contexts are used when calling
/// [`EditorState.indentation`](#state.EditorState^indentation). They
/// provide helper utilities useful in indentation logic, and can
/// selectively override the indentation reported for some
/// lines.
export class IndentContext {
  /// Create an indent context.
  constructor(
    /// The editor state.
    readonly state: EditorState,
    /// @internal
    readonly options: {
      /// Override line indentations provided to the indentation
      /// helper function, which is useful when implementing region
      /// indentation, where indentation for later lines needs to refer
      /// to previous lines, which may have been reindented compared to
      /// the original start state. If given, this function should
      /// return -1 for lines (given by start position) that didn't
      /// change, and an updated indentation otherwise.
      overrideIndentation?: (pos: number) => number,
      /// Make it look, to the indent logic, like a line break was
      /// added at the given position (which is mostly just useful for
      /// implementing
      /// [`insertNewlineAndIndent`](#commands.insertNewlineAndIndent).
      simulateBreak?: number,
      /// When `simulateBreak` is given, this can be used to make the
      /// simulate break behave like a double line break.
      simulateDoubleBreak?: boolean
    } = {}
  ) {}

  /// The indent unit (number of columns per indentation level).
  get unit() { return this.state.indentUnit }

  /// Get the text directly after `pos`, either the entire line
  /// or the next 100 characters, whichever is shorter.
  textAfterPos(pos: number) {
    let sim = this.options?.simulateBreak
    if (pos == sim && this.options?.simulateDoubleBreak) return ""
    return this.state.sliceDoc(pos, Math.min(pos + 100,
                                             sim != null && sim > pos ? sim : 1e9,
                                             this.state.doc.lineAt(pos).to))
  }

  /// find the column position (taking tabs into account) of the given
  /// position in the given string.
  countColumn(line: string, pos: number) {
    return countColumn(pos < 0 ? line : line.slice(0, pos), 0, this.state.tabSize)
  }

  /// Find the indentation column of the given document line.
  lineIndent(line: Line) {
    let override = this.options?.overrideIndentation
    if (override) {
      let overriden = override(line.from)
      if (overriden > -1) return overriden
    }
    let text = line.slice(0, Math.min(100, line.length))
    return this.countColumn(text, text.search(/\S/))
  }

  /// Find the column for the given position.
  column(pos: number) {
    let line = this.state.doc.lineAt(pos), text = line.slice(0, pos - line.from)
    let result = this.countColumn(text, pos - line.from)
    let override = this.options?.overrideIndentation ? this.options.overrideIndentation(line.from) : -1
    if (override > -1) result += override - this.countColumn(text, text.search(/\S/))
    return result
  }
}
