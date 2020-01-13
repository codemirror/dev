import {NodeProp, Subtree} from "lezer-tree"
import {EditorState, Syntax} from "../../state"

/// This node prop is used to associate folding information with node
/// types. Given a subtree, it should check whether that tree is
/// foldable and return the range that can be collapsed when it is.
export const foldNodeProp = new NodeProp<(subtree: Subtree, state: EditorState) => ({from: number, to: number} | null)>()

export function syntaxFolding(syntax: Syntax) {
  return EditorState.foldable.of((state: EditorState, start: number, end: number) => {
    let tree = syntax.getPartialTree(state, start, Math.min(state.doc.length, end + 100))
    let inner = tree.resolve(end)
    let found: null | {from: number, to: number} = null
    for (let cur: Subtree | null = inner; cur; cur = cur.parent) {
      if (cur.end <= end || cur.start > end) continue
      if (found && cur.start < start) break
      let prop = cur.type.prop(foldNodeProp)
      if (prop) {
        let value = prop(cur, state)
        if (value && value.from <= end && value.from >= start && value.to > end) found = value
      }
    }
    return found
  })
}
