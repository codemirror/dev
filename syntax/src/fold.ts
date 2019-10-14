import {NodeProp, Subtree} from "lezer-tree"
import {EditorState, Syntax} from "../../state"

/// This node prop is used to associate folding information with node
/// types. Given a subtree, it should check whether that tree is
/// foldable and return the range that can be collapsed when it is.
export const foldNodeProp = new NodeProp<(subtree: Subtree) => ({from: number, to: number} | null)>()

export function syntaxFolding(syntax: Syntax) {
  return EditorState.foldable((state: EditorState, start: number, end: number) => {
    let tree = syntax.getPartialTree(state, start, Math.min(state.doc.length, end + 100))
    let inner = tree.resolve(end)
    let found: null | {from: number, to: number} = null
    for (let cur: Subtree | null = inner; cur; cur = cur.parent) {
      if (cur.start < start || cur.end <= end) continue
      let prop = cur.type.prop(foldNodeProp)
      if (prop) {
        let value = prop(cur)
        if (value) found = value
      }
    }
    return found
  })
}
