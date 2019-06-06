import {Syntax, syntax} from "../../syntax/src/syntax"
import {StringStream} from "../../legacy-modes/src/stringstream" // FIXME move here
import {StringStreamCursor} from "../../legacy-modes/src/stringstreamcursor" // FIXME move here
import {Slot} from "../../extension/src/extension"
import {EditorState, StateExtension, StateField, Transaction} from "../../state/src/"
import {tokenTypes} from "../../highlight/src/highlight"
import {Tree, TagMap} from "lezer-tree"

export {StringStream}

export abstract class StreamParser<State> {
  abstract token(stream: StringStream, state: State): string | null

  blankLine(state: State) {}

  startState(): State { return (true as any) }

  copyState(state: State) {
    if (typeof state != "object") return state
    let newState = {} as State
    for (let prop in state) {
      let val = state[prop]
      newState[prop] = (val instanceof Array ? val.slice() : val) as any
    }
    return newState
  }
}

function readToken<State>(parser: StreamParser<State>, state: State, stream: StringStream) {
  stream.start = stream.pos
  for (let i = 0; i < 10; i++) {
    let result = parser.token(stream, state)
    if (stream.pos > stream.start) return result
  }
  throw new Error("Stream parser failed to advance stream.")
}

export class StreamSyntax extends Syntax {
  private field: StateField<SyntaxState<any>>
  public extension: StateExtension

  constructor(name: string, readonly parser: StreamParser<any>, slots: Slot[] = []) {
    super(name, slots.concat(tokenTypes(tokenMap)))
    this.field = new StateField<SyntaxState<any>>({
      init() { return new SyntaxState(Tree.empty, [parser.startState()], 1, 0, null) },
      apply(tr, value) { return value.apply(tr) }
    })
    this.extension = StateExtension.all(syntax(this), this.field.extension)
  }

  getTree(state: EditorState, from: number, to: number): Tree {
    return state.getField(this.field).getTree(this.parser, state, to)
  }
}

const CACHE_STEP_SHIFT = 6, CACHE_STEP = 1 << CACHE_STEP_SHIFT

const MAX_RECOMPUTE_DISTANCE = 20e3

class SyntaxState<ParseState> {
  constructor(public tree: Tree,
              // Slot 0 stores the start state (line 1), slot 1 the
              // state at the start of line 65, etc, so lineNo ==
              // (index * CACHE_STEP) + 1
              public cache: ParseState[],
              public frontierLine: number,
              public frontierPos: number,
              public frontierState: ParseState | null) {}

  apply(tr: Transaction) {
    if (!tr.docChanged) return this
    let {start, number} = tr.doc.lineAt(tr.changes.changedRanges()[0].fromA)
    if (number >= this.frontierLine)
      return new SyntaxState(this.tree, this.cache.slice(), this.frontierLine, this.frontierPos, this.frontierState)
    else {
      return new SyntaxState(this.tree.cut(start),
                             this.cache.slice(0, (number >> CACHE_STEP_SHIFT) + 1), number, start, null)
    }
  }

  maybeStoreState(parser: StreamParser<ParseState>, lineBefore: number, state: ParseState) {
    if (lineBefore % CACHE_STEP == 0)
      this.cache[(lineBefore - 1) >> CACHE_STEP_SHIFT] = parser.copyState(state)
  }

  cachedState(parser: StreamParser<ParseState>, editorState: EditorState, line: number) {
    let cacheIndex = Math.min(this.cache.length - 1, (line - 1) >> CACHE_STEP_SHIFT)
    let cachedLine = (cacheIndex << CACHE_STEP_SHIFT) + 1
    let startPos = editorState.doc.line(cachedLine).start
    if (line - cachedLine > CACHE_STEP && editorState.doc.line(line).start - startPos > MAX_RECOMPUTE_DISTANCE)
      return null
    let state = parser.copyState(this.cache[cacheIndex])
    let cursor = new StringStreamCursor(editorState.doc, startPos, editorState.tabSize)
    for (let l = cachedLine; l < line; l++) {
      let stream = cursor.next()
      if (stream.eol()) {
        parser.blankLine(state)
      } else {
        while (!stream.eol()) readToken(parser, state, stream)
      }
      this.maybeStoreState(parser, l, state)
    }
    return state
  }

  highlightUpto(parser: StreamParser<ParseState>, editorState: EditorState, to: number) {
    let state = this.frontierState || this.cachedState(parser, editorState, this.frontierLine)
    if (!state) return // FIXME make up a state? return a partial temp tree?
    // FIXME interrupt at some point when too much work is done
    let cursor = new StringStreamCursor(editorState.doc, this.frontierPos, editorState.tabSize)
    let buffer: number[] = []
    let line = this.frontierLine, pos = this.frontierPos
    while (pos < to) {
      let stream = cursor.next(), offset = cursor.offset
      if (stream.eol()) {
        parser.blankLine(state)
      } else {
        while (!stream.eol()) {
          let type = readToken(parser, state, stream)
          if (type) buffer.push(tokenID(type), offset + stream.start, offset + stream.pos, 4)
        }
      }
      this.maybeStoreState(parser, line, state)
      line++
      pos += stream.string.length + 1
    }
    let tree = Tree.fromBuffer(buffer)
    this.tree = this.tree.append(tree)
    this.frontierLine = line
    this.frontierPos = pos
    this.frontierState = state
  }

  getTree(parser: StreamParser<ParseState>, state: EditorState, to: number) {
    if (this.frontierPos < to) this.highlightUpto(parser, state, to)
    return this.tree
  }
}

const tokenTable: {[name: string]: number} = Object.create(null)
const tokenNames: string[] = [""]
const tokenMap = new TagMap(tokenNames)

function tokenID(name: string) {
  let id = tokenTable[name]
  if (id == null) {
    id = tokenTable[name] = (tokenNames.length << 1) + 1
    tokenNames.push(name)
  }
  return id
}
