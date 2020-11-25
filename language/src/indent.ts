import {NodeProp, SyntaxNode, Tree} from "lezer-tree"
import {EditorState, Extension, Transaction, Facet} from "@codemirror/next/state"
import {Line, countColumn} from "@codemirror/next/text"
import {Language} from "./language"

/// Facet that defines a way to query for automatic indentation
/// depth at the start of a given line.
export const indentation = Facet.define<(context: IndentContext, pos: number) => number>()

/// Facet for overriding the unit by which indentation happens.
/// Should be a string consisting either entirely of spaces or
/// entirely of tabs. When not set, this defaults to 2 spaces.
export const indentUnit = Facet.define<string, string>({
  combine: values => {
    if (!values.length) return "  "
    if (!/^(?: +|\t+)$/.test(values[0])) throw new Error("Invalid indent unit: " + JSON.stringify(values[0]))
    return values[0]
  }
})

/// Return the _column width_ of an indent unit in the state.
/// Determined by the [`indentUnit`](#state.EditorState^indentUnit)
/// facet, and [`tabSize`](#state.EditorState^tabSize) when that
/// contains tabs.
export function getIndentUnit(state: EditorState) {
  let unit = state.facet(indentUnit)
  return unit.charCodeAt(0) == 9 ? state.tabSize * unit.length : unit.length
}

/// Create an indentation string that covers columns 0 to `cols`.
/// Will use tabs for as much of the columns as possible when the
/// [`indentUnit`](#state.EditorState^indentUnit) facet contains
/// tabs.
export function indentString(state: EditorState, cols: number) {
  let result = "", ts = state.tabSize
  if (state.facet(indentUnit).charCodeAt(0) == 9) while (cols >= ts) {
    result += "\t"
    cols -= ts
  }
  for (let i = 0; i < cols; i++) result += " "
  return result
}    

/// Indentation contexts are used when calling
/// [`EditorState.indentation`](#state.EditorState^indentation). They
/// provide helper utilities useful in indentation logic, and can
/// selectively override the indentation reported for some
/// lines.
export class IndentContext {
  /// The indent unit (number of columns per indentation level).
  unit: number

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
  ) {
    this.unit = getIndentUnit(state)
  }

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

/// A syntax tree node prop used to associate indentation strategies
/// with node types. Such a strategy is a function from an indentation
/// context to a number. That number may be -1, to indicate that no
/// definitive indentation can be determined, or a column number to
/// which the given line should be indented.
export const indentNodeProp = new NodeProp<(context: TreeIndentContext) => number>()

export function syntaxIndentation(language: Language) {
  return indentation.of((cx: IndentContext, pos: number) => {
    return computeIndentation(cx, language.getTree(cx.state), pos)
  })
}

// Compute the indentation for a given position from the syntax tree.
function computeIndentation(cx: IndentContext, ast: Tree, pos: number) {
  let tree: SyntaxNode | null = ast.resolve(pos)

  // Enter previous nodes that end in empty error terms, which means
  // they were broken off by error recovery, so that indentation
  // works even if the constructs haven't been finished.
  for (let scan = tree!, scanPos = pos;;) {
    let last = scan.childBefore(scanPos)
    if (!last) break
    if (last.type.isError && last.from == last.to) {
      tree = scan
      scanPos = last.from
    } else {
      scan = last
      scanPos = scan.to + 1
    }
  }

  for (; tree; tree = tree.parent) {
    let strategy = indentStrategy(tree)
    if (strategy) return strategy(new TreeIndentContext(cx, pos, tree))
  }
  return -1
}

function ignoreClosed(cx: TreeIndentContext) {
  return cx.pos == cx.options?.simulateBreak && cx.options?.simulateDoubleBreak
}

function indentStrategy(tree: SyntaxNode): ((context: TreeIndentContext) => number) | null {
  let strategy = tree.type.prop(indentNodeProp)
  if (strategy) return strategy
  let first = tree.firstChild, close: readonly string[] | undefined
  if (first && (close = first.type.prop(NodeProp.closedBy))) {
    let last = tree.lastChild, closed = last && close.indexOf(last.name) > -1
    return cx => delimitedStrategy(cx, true, 1, undefined, closed && !ignoreClosed(cx) ? last!.from : undefined)
  }
  return tree.parent == null ? topIndent : null
}

function topIndent() { return 0 }

/// Objects of this type provide context information and helper
/// methods to indentation functions.
export class TreeIndentContext extends IndentContext {
  /// @internal
  constructor(
    base: IndentContext,
    /// The position at which indentation is being computed.
    readonly pos: number,
    /// The syntax tree node for which the indentation strategy is
    /// registered.
    readonly node: SyntaxNode) {
    super(base.state, base.options)
  }

  /// Get the text directly after `this.pos`, either the entire line
  /// or the next 100 characters, whichever is shorter.
  get textAfter() {
    return this.textAfterPos(this.pos)
  }

  /// Get the indentation at the reference line for `this.node`, which
  /// is the line on which it starts, unless there is a node that is
  /// _not_ a parent of this node covering the start of that line. If
  /// so, the line at the start of that node is tried, again skipping
  /// on if it is covered by another such node.
  get baseIndent() {
    let line = this.state.doc.lineAt(this.node.from)
    // Skip line starts that are covered by a sibling (or cousin, etc)
    for (;;) {
      let atBreak = this.node.resolve(line.from)
      while (atBreak.parent && atBreak.parent.from == atBreak.from) atBreak = atBreak.parent
      if (isParent(atBreak, this.node)) break
      line = this.state.doc.lineAt(atBreak.from)
    }
    return this.lineIndent(line)
  }
}

function isParent(parent: SyntaxNode, of: SyntaxNode) {
  for (let cur: SyntaxNode | null = of; cur; cur = cur.parent) if (parent == cur) return true
  return false
}

// Check whether a delimited node is aligned (meaning there are
// non-skipped nodes on the same line as the opening delimiter). And
// if so, return the opening token.
function bracketedAligned(context: TreeIndentContext) {
  let tree = context.node
  let openToken = tree.childAfter(tree.from), last = tree.lastChild
  if (!openToken) return null
  let sim = context.options?.simulateBreak
  let openLine = context.state.doc.lineAt(openToken.from)
  let lineEnd = sim == null || sim <= openLine.from ? openLine.to : Math.min(openLine.to, sim)
  for (let pos = openToken.to;;) {
    let next = tree.childAfter(pos)
    if (!next || next == last) return null
    if (!next.type.isSkipped)
      return next.from < lineEnd ? openToken : null
    pos = next.to
  }
}

/// An indentation strategy for delimited (usually bracketed) nodes.
/// Will, by default, indent one unit more than the parent's base
/// indent unless the line starts with a closing token. When `align`
/// is true and there are non-skipped nodes on the node's opening
/// line, the content of the node will be aligned with the end of the
/// opening node, like this:
///
///     foo(bar,
///         baz)
export function delimitedIndent({closing, align = true, units = 1}: {closing: string, align?: boolean, units?: number}) {
  return (context: TreeIndentContext) => delimitedStrategy(context, align, units, closing)
}

function delimitedStrategy(context: TreeIndentContext, align: boolean, units: number, closing?: string, closedAt?: number) {
  let after = context.textAfter, space = after.match(/^\s*/)![0].length
  let closed = closing && after.slice(space, space + closing.length) == closing || closedAt == context.pos + space
  let aligned = align ? bracketedAligned(context) : null
  if (aligned) return closed ? context.column(aligned.from) : context.column(aligned.to)
  return context.baseIndent + (closed ? 0 : context.unit * units)
}

/// An indentation strategy that aligns a node content to its base
/// indentation.
export const flatIndent = (context: TreeIndentContext) => context.baseIndent

/// Creates an indentation strategy that, by default, indents
/// continued lines one unit more than the node's base indentation.
/// You can provide `except` to prevent indentation of lines that
/// match a pattern (for example `/^else\b/` in `if`/`else`
/// constructs), and you can change the amount of units used with the
/// `units` option.
export function continuedIndent({except, units = 1}: {except?: RegExp, units?: number} = {}) {
  return (context: TreeIndentContext) => {
    let matchExcept = except && except.test(context.textAfter)
    return context.baseIndent + (matchExcept ? 0 : units * context.unit)
  }
}

const DontIndentBeyond = 200

/// Enables reindentation on input. When a language defines an
/// `indentOnInput` field in its [language
/// data](#state.EditorState.languageDataAt), which must hold a regular
/// expression, the line at the cursor will be reindented whenever new
/// text is typed and the input from the start of the line up to the
/// cursor matches that regexp.
///
/// To avoid unneccesary reindents, it is recommended to start the
/// regexp with `^` (usually followed by `\s*`), and end it with `$`.
/// For example, `/^\s*\}$` will reindent when a closing brace is
/// added at the start of a line.
export function indentOnInput(): Extension {
  return EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged || tr.annotation(Transaction.userEvent) != "input") return tr
    let rules = tr.startState.languageDataAt<RegExp>("indentOnInput", tr.startState.selection.primary.head)
    if (!rules.length) return tr
    let doc = tr.newDoc, {head} = tr.newSelection.primary, line = doc.lineAt(head)
    if (head > line.from + DontIndentBeyond) return tr
    let lineStart = doc.sliceString(line.from, head)
    if (!rules.some(r => r.test(lineStart))) return tr
    let {state} = tr, last = -1, changes = []
    for (let {head} of state.selection.ranges) {
      let line = state.doc.lineAt(head)
      if (line.from == last) continue
      last = line.from
      let indent = Math.max(...state.facet(indentation).map(f => f(new IndentContext(state), line.from)))
      if (indent < 0) continue
      let cur = /^\s*/.exec(line.slice(0, Math.min(line.length, DontIndentBeyond)))![0]
      let norm = indentString(state, indent)
      if (cur != norm)
        changes.push({from: line.from, to: line.from + cur.length, insert: norm})
    }
    return changes.length ? [tr, {changes}] : tr
  })
}
