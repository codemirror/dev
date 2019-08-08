import {EditorState, StateExtension} from "./state"
import {Tree} from "lezer-tree"

export type SyntaxRequest = Promise<Tree> & {canceled?: boolean}

export abstract class Syntax {
  abstract extension: StateExtension

  getTree(state: EditorState, from: number, to: number): SyntaxRequest {
    let later = null
    let direct = this.tryGetTree(state, from, to, (req) => later = req)
    return later || Promise.resolve(direct)
  }

  abstract tryGetTree(state: EditorState, from: number, to: number, unfinished?: (req: SyntaxRequest) => void): Tree
}
