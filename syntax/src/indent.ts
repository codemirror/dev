import {Line} from "../../text/src"
import {NodeType, NodeProp, Subtree, Tree} from "lezer-tree"
import {EditorState} from "../../state/src/"

/// A syntax tree node prop used to associate indentation strategies
/// with node types. Such a strategy is a function from an indentation
/// context to a number. That number may be -1, to indicate that no
/// definitive indentation can be determined, or a column number to
/// which the given line should be indented.
export const indentNodeProp = new NodeProp<(context: IndentContext) => number>()

/// An extension that enables syntax-tree based indentation.
export const syntaxIndentation = EditorState.extend.unique<null>(() => EditorState.indentation(indentationBehavior))(null)

function indentationBehavior(state: EditorState, pos: number) {
  for (let syntax of state.behavior(EditorState.syntax)) {
    let tree = syntax.getPartialTree(state, pos, pos)
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
    let strategy = indentStrategy(tree.type) || (tree.parent == null ? topIndent : null)
    if (strategy) return strategy(new IndentContext(state, pos, tree))
  }
  return -1
}

function indentStrategy(type: NodeType) {
  let strategy = type.prop(indentNodeProp)
  if (!strategy) {
    let delim = type.prop(NodeProp.delim)
    if (delim) return delimitedIndent({closing: delim.split(" ")[1]})
  }
  return strategy
}

function topIndent() { return 0 }

/// Objects of this type provide context information and helper
/// methods to indentation functions.
export class IndentContext {
  /// @internal
  constructor(
    /// The editor state.
    readonly state: EditorState,
    /// The position at which indentation is being computed.
    readonly pos: number,
    /// The syntax tree node for which the indentation strategy is
    /// registered.
    readonly node: Subtree) {}

  /// The indent unit (number of spaces per indentation level).
  get unit() { return this.state.indentUnit }

  /// Get the text directly after `this.pos`, either the entire line
  /// or the next 50 characters, whichever is shorter.
  get textAfter() {
    return this.state.doc.slice(this.pos, Math.min(this.pos + 50, this.state.doc.lineAt(this.pos).end)).match(/^\s*(.*)/)![1]
  }

  /// find the column position (taking tabs into account) of the given
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

  /// Find the indentation column of the given document line.
  lineIndent(line: Line) {
    let text = line.slice(0, Math.min(50, line.length, this.node.start > line.start ? this.node.start - line.start : 1e8))
    return this.countColumn(text, text.search(/\S/))
  }

  /// Get the indentation at the reference line for `this.tree`, which
  /// is the line on which it starts, unless there is a node that is
  /// _not_ a parent of this node covering the start of that line. If
  /// so, the line at the start of that node is tried, again skipping
  /// on if it is covered by another such node.
  get baseIndent() {
    let line = this.state.doc.lineAt(this.node.start)
    // Skip line starts that are covered by a sibling (or cousin, etc)
    for (;;) {
      let atBreak = this.node.resolve(line.start)
      while (atBreak.parent && atBreak.parent.start == atBreak.start) atBreak = atBreak.parent
      if (isParent(atBreak, this.node)) break
      line = this.state.doc.lineAt(atBreak.start)
    }
    return this.lineIndent(line)
  }

  /// Find the column for the given position.
  column(pos: number) {
    let line = this.state.doc.lineAt(pos)
    return this.countColumn(line.slice(0, pos - line.start), pos - line.start)
  }
}

function isParent(parent: Subtree, of: Subtree) {
  for (let cur: Subtree | null = of; cur; cur = cur.parent) if (parent == cur) return true
  return false
}

// Check whether a delimited node is aligned (meaning there are
// non-skipped nodes on the same line as the opening delimiter). And
// if so, return the opening token.
function bracketedAligned(context: IndentContext) {
  let tree = context.node
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
export function delimitedIndent({closing, align = true, units = 1}: {closing: string, align?: boolean, units?: number}) {
  return (context: IndentContext) => {
    let closed = context.textAfter.slice(0, closing.length) == closing
    let aligned = align ? bracketedAligned(context) : null
    if (aligned) return closed ? context.column(aligned.start) : context.column(aligned.end)
    return context.baseIndent + (closed ? 0 : context.unit * units)
  }
}

/// An indentation strategy that aligns a node content to its base
/// indentation.
export const flatIndent = (context: IndentContext) => context.baseIndent

/// Creates an indentation strategy that, by default, indents
/// continued lines one unit more than the node's base indentation.
/// You can provide `except` to prevent indentation of lines that
/// match a pattern (for example `/^else\b/` in `if`/`else`
/// constructs), and you can change the amount of units used with the
/// `units` option.
export function continuedIndent({except, units = 1}: {except?: RegExp, units?: number} = {}) {
  return (context: IndentContext) => {
    let matchExcept = except && except.test(context.textAfter)
    return context.baseIndent + (matchExcept ? 0 : units * context.unit)
  }
}
