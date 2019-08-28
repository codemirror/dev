import {NodeProp, Subtree, Tree} from "lezer-tree"
import {EditorState} from "../../state/src/"

/// A syntax tree node prop used to associate indentation strategies
/// with node types.
export const indentNodeProp = new NodeProp<IndentStrategy>()

/// An extension that enables syntax-tree based indentation.
export const syntaxIndentation = EditorState.extend.unique<null>(() => EditorState.indentation(indentationBehavior))(null)

function indentationBehavior(state: EditorState, pos: number) {
  for (let syntax of state.behavior.get(EditorState.syntax)) {
    let tree = syntax.tryGetTree(state, pos, pos)
    if (tree) {
      let result = computeIndentation(state, tree, pos)
      if (result > -1) return result
    }
  }
  return -1
}

// Compute the indentation for a given position from the syntax tree.
function computeIndentation(state: EditorState, ast: Tree, pos: number) {
  let tree: Subtree | null = ast.resolve(pos)
    
  // Enter previous nodes that end in empty error terms, which means
  // they were broken off by error recovery, so that indentation
  // works even if the constructs haven't been finished.
  for (let scan = tree!, scanPos = pos;;) {
    let last = scan.childBefore(scanPos)
    if (!last) break
    if (last.type.prop(NodeProp.error) && last.start == last.end) {
      tree = scan
      scanPos = last.start
    } else {
      scan = last
      scanPos = scan.end + 1
    }
  }

  for (; tree; tree = tree.parent) {
    let strategy = tree.type.prop(indentNodeProp) || (tree.parent == null ? topIndent : null)
    if (strategy) {
      let indentContext = new IndentContext(state, pos, tree, strategy, null)
      return indentContext.strategy.getIndent(indentContext)
    }
  }
  return -1
}

/// Objects of this type provide context information to indentation
/// strategies. A context is created for the innermost node + strategy
/// pair that the indenter finds, and from there strategies may
/// continue querying contexts for wrapping via `.next`.
export class IndentContext {
  private _next: IndentContext | null = null

  /// @internal
  constructor(
    /// The editor state.
    readonly state: EditorState,
    /// The position at which indentation is being computed.
    readonly pos: number,
    /// The current syntax tree node.
    readonly tree: Subtree,
    /// @internal
    readonly strategy: IndentStrategy,
    /// If this context was reached through another context's `next`
    /// getter, this points at that inner context.
    readonly prev: IndentContext | null) {}

  /// The indent unit (number of spaces per indentation level).
  get unit() { return this.state.indentUnit }

  /// Get an indentation context for the next wrapping node that has a
  /// strategy associated with it, or the top level (with a strategy
  /// that always returns 0) if no such node is found.
  get next() {
    if (this._next) return this._next
    let last = this.tree, found = null
    for (let tree = this.tree.parent; !found && tree; tree = tree.parent) {
      found = tree.type.prop(indentNodeProp)
      last = tree
    }
    return this._next = new IndentContext(this.state, this.pos, last, found || topIndent, this)
  }

  /// Get the text directly after `this.pos`, either the entire line
  /// or the next 50 characters, whichever is shorter.
  get textAfter() {
    return this.state.doc.slice(this.pos, Math.min(this.pos + 50, this.state.doc.lineAt(this.pos).end)).match(/^\s*(.*)/)![1]
  }

  /// Get the line description at the start of `this.tree`.
  get startLine() {
    return this.state.doc.lineAt(this.tree.start)
  }

  /// Find the column position (taking tabs into account) of the given
  /// position in the given string.
  countColumn(line: string, pos: number) {
    // FIXME use extending character information
    if (pos < 0) pos = line.length
    let tab = this.state.tabSize
    for (var i = 0, n = 0;;) {
      let nextTab = line.indexOf("\t", i);
      if (nextTab < 0 || nextTab >= pos) return n + (pos - i)
      n += nextTab - i
      n += tab - (n % tab)
      i = nextTab + 1
    }
  }

  /// Find the indentation column of the given line, which defaults to
  /// the line at which `this.tree` starts.
  lineIndent(line = this.startLine) {
    let text = line.slice(0, Math.min(50, line.length, this.tree.start > line.start ? this.tree.start - line.start : 1e8))
    return this.countColumn(text, text.search(/\S/))
  }

  /// Find the column for the given position.
  column(pos: number) {
    let line = this.state.doc.lineAt(pos)
    return this.countColumn(line.slice(0, pos - line.start), pos - line.start)
  }

  /// Get this strategy's base indent (or, if it doesn't define one,
  /// the one from the next parent that does define one).
  get baseIndent() {
    for (let cx = this as IndentContext;; cx = cx.next) {
      let f = cx.strategy.baseIndent
      let result = f ? f(cx) : -1
      if (result > -1) return result
    }
  }
}

/// A description of how to indent inside a node type.
export interface IndentStrategy {
  /// Compute the indentation for a position directly inside this
  /// node, with no smaller wrapping node that has a strategy.
  getIndent: (context: IndentContext) => number
  /// Compute the base, contextual indentation for a node. This will
  /// often be used by inner nodes as a starting value.
  baseIndent?: (context: IndentContext) => number
}

// Trivial indent strategy applied when the search hits the root of
// the syntax tree.
const topIndent: IndentStrategy = {
  getIndent() { return 0 },
  baseIndent() { return 0 }
}

// Check whether a delimited node is aligned (meaning there are
// non-skipped nodes on the same line as the opening delimiter). And
// if so, return the opening token.
function bracketedAligned(context: IndentContext) {
  let tree = context.tree
  let openToken = tree.childAfter(tree.start)
  if (!openToken) return null
  let openLine = context.state.doc.lineAt(openToken.start)
  for (let pos = openToken.end;;) {
    let next = tree.childAfter(pos)
    if (!next) return null
    if (!next.type.prop(NodeProp.skipped))
      return next.start < openLine.end ? openToken : null
    pos = next.end
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
export function delimitedIndent({closing, align = true}: {closing: string, align?: boolean}): IndentStrategy {
  return {
    getIndent(context: IndentContext) {
      let closed = context.textAfter.slice(0, closing.length) == closing
      let aligned = align ? bracketedAligned(context) : null
      if (aligned) return closed ? context.column(aligned.start) : context.column(aligned.end)
      return context.next.baseIndent + (closed ? 0 : context.unit)
    },
    baseIndent(context: IndentContext) {
      let newLine = context.startLine.start != context.prev!.startLine.start
      let aligned = align && newLine ? bracketedAligned(context) : null
      if (aligned) return context.column(aligned.end)
      return context.next.baseIndent + (newLine ? context.unit : 0)
    }
  }
}

// FIXME automatically create a delimitedIndent for nodes with delim prop?

/// Instance of `delimitedIndent` for parentheses.
export const parenIndent = delimitedIndent({closing: ")"})
/// Instance of `delimitedIndent` for curly braces.
export const braceIndent = delimitedIndent({closing: "}"})
/// Instance of `delimitedIndent` for square brackets.
export const bracketIndent = delimitedIndent({closing: "]"})

/// Indentation strategy for statement-like nodes. Will produce a base
/// indentation aligned with the indentation of the line that starts
/// the node, and add one indentation unit to that when continuing the
/// node on a new line.
export const statementIndent: IndentStrategy = {
  getIndent(context: IndentContext) {
    return context.baseIndent + context.unit
  },
  baseIndent(context: IndentContext) {
    return context.lineIndent()
  }
}

/// Extended form of `statementIndent` that doesn't continued lines
/// that start with a given regular expression. Can be used for things
/// like `if`/`else` blocks, where a continuing line that starts with
/// `else` shouldn't be indented.
export function compositeStatementIndent(dedentBefore: RegExp): IndentStrategy {
  return {
    getIndent(context: IndentContext) {
      return context.baseIndent + (dedentBefore.test(context.textAfter) ? 0 : context.unit)
    },
    baseIndent(context: IndentContext) {
      return context.lineIndent()
    }
  }
}

/// An indentation strategy that doesn't indent (returns -1 to
/// indicate that no indentation value is available).
export const dontIndent: IndentStrategy = {
  getIndent() { return -1 }
}
