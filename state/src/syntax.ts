import {EditorState} from "./state"
import {Extension} from "../../extension/src/extension"
import {Tree} from "lezer-tree"

export type SyntaxRequest = Promise<Tree> & {canceled?: boolean}

export abstract class Syntax {
  abstract extension: Extension

  getTree(state: EditorState, from: number, to: number): SyntaxRequest {
    let later = null
    let direct = this.tryGetTree(state, from, to, (req) => later = req)
    return later || Promise.resolve(direct)
  }

  abstract tryGetTree(state: EditorState, from: number, to: number, unfinished?: (req: SyntaxRequest) => void): Tree
}
