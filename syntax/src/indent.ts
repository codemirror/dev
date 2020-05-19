import {NodeType, NodeProp, Subtree, Tree} from "lezer-tree"
import {EditorState, Syntax, IndentContext} from "@codemirror/next/state"

/// A syntax tree node prop used to associate indentation strategies
/// with node types. Such a strategy is a function from an indentation
/// context to a number. That number may be -1, to indicate that no
/// definitive indentation can be determined, or a column number to
/// which the given line should be indented.
export const indentNodeProp = new NodeProp<(context: TreeIndentContext) => number>()

export function syntaxIndentation(syntax: Syntax) {
  return EditorState.indentation.of((cx: IndentContext, pos: number) => {
    return computeIndentation(cx, syntax.getTree(cx.state), pos)
  })
}

// Compute the indentation for a given position from the syntax tree.
function computeIndentation(cx: IndentContext, ast: Tree, pos: number) {
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
    if (strategy) return strategy(new TreeIndentContext(cx, pos, tree))
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
export class TreeIndentContext extends IndentContext {
  /// @internal
  constructor(
    base: IndentContext,
    /// The position at which indentation is being computed.
    readonly pos: number,
    /// The syntax tree node for which the indentation strategy is
    /// registered.
    readonly node: Subtree) {
    super(base.state, base.overrideIndentation, base.simulateBreak)
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
}

function isParent(parent: Subtree, of: Subtree) {
  for (let cur: Subtree | null = of; cur; cur = cur.parent) if (parent == cur) return true
  return false
}

// Check whether a delimited node is aligned (meaning there are
// non-skipped nodes on the same line as the opening delimiter). And
// if so, return the opening token.
function bracketedAligned(context: TreeIndentContext) {
  let tree = context.node
  let openToken = tree.childAfter(tree.start), last = tree.lastChild
  if (!openToken || context.simulateBreak == openToken.end) return null
  let openLine = context.state.doc.lineAt(openToken.start)
  for (let pos = openToken.end;;) {
    let next = tree.childAfter(pos)
    if (!next || next == last) return null
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
  return (context: TreeIndentContext) => {
    let after = context.textAfter.match(/^\s*(.*)/)![1]
    let closed = after.slice(0, closing.length) == closing
    let aligned = align ? bracketedAligned(context) : null
    if (aligned) return closed ? context.column(aligned.start) : context.column(aligned.end)
    return context.baseIndent + (closed ? 0 : context.unit * units)
  }
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
