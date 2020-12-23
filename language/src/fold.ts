import {NodeProp, SyntaxNode} from "lezer-tree"
import {EditorState, Facet} from "@codemirror/next/state"
import {syntaxTree} from "./language"

/// A facet that registers a code folding service. When called with
/// the extent of a line, such a function should return a foldable
/// range that starts on that line (but continues beyond it), if one
/// can be found.
export const foldService = Facet.define<(state: EditorState, lineStart: number, lineEnd: number) => ({from: number, to: number} | null)>()

/// This node prop is used to associate folding information with
/// syntax node types. Given a syntax node, it should check whether
/// that tree is foldable and return the range that can be collapsed
/// when it is.
export const foldNodeProp = new NodeProp<(node: SyntaxNode, state: EditorState) => ({from: number, to: number} | null)>()

function syntaxFolding(state: EditorState, start: number, end: number) {
  let tree = syntaxTree(state)
  if (tree.length == 0) return null
  let inner = tree.resolve(end)
  let found: null | {from: number, to: number} = null
  for (let cur: SyntaxNode | null = inner; cur; cur = cur.parent) {
    if (cur.to <= end || cur.from > end) continue
    if (found && cur.from < start) break
    let prop = cur.type.prop(foldNodeProp)
    if (prop) {
      let value = prop(cur, state)
      if (value && value.from <= end && value.from >= start && value.to > end) found = value
    }
  }
  return found
}

/// Check whether the given line is foldable. First asks any fold
/// services registered through
/// [`foldService`](#language.foldService), and if none of them return
/// a result, tries to query the [fold node
/// prop](#language.foldNodeProp) of syntax nodes that cover the end
/// of the line.
export function foldable(state: EditorState, lineStart: number, lineEnd: number) {
  for (let service of state.facet(foldService)) {
    let result = service(state, lineStart, lineEnd)
    if (result) return result
  }
  return syntaxFolding(state, lineStart, lineEnd)
}
