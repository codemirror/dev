import {Syntax, syntax} from "../../syntax/src/syntax"
import {StringStream, StringStreamCursor} from "./stringstream"
import {Slot} from "../../extension/src/extension"
import {EditorState, StateExtension, StateField, Transaction} from "../../state/src/"
import {tokenTypes} from "../../highlight/src/highlight"
import {Tree, TagMap} from "lezer-tree"

export {StringStream}

export type StreamParserSpec<State> = {
  token(stream: StringStream, state: State, editorState: EditorState): string | null
  blankLine?(state: State, editorState: EditorState): void
  startState?(editorState: EditorState): State
  copyState?(state: State): State
  indent?(state: State, textAfter: string, editorState: EditorState): number
}

export class StreamParser<State> {
  token: (stream: StringStream, state: State, editorState: EditorState) => string | null
  blankLine: (state: State, editorState: EditorState) => void
  // FIXME maybe support passing something from the parent when nesting
  startState: (editorState: EditorState) => State
  copyState: (state: State) => State
  indent: (state: State, textAfter: string, editorState: EditorState) => number
  
  constructor(spec: StreamParserSpec<State>) {
    this.token = spec.token
    this.blankLine = spec.blankLine || (() => {})
    this.startState = spec.startState || (() => (true as any))
    this.copyState = spec.copyState || defaultCopyState
    this.indent = spec.indent || (() => -1)
  }

  readToken(state: State, stream: StringStream, editorState: EditorState) {
    stream.start = stream.pos
    for (let i = 0; i < 10; i++) {
      let result = this.token(stream, state, editorState)
      if (stream.pos > stream.start) return result
    }
    throw new Error("Stream parser failed to advance stream.")
  }
}

function defaultCopyState<State>(state: State) {
  if (typeof state != "object") return state
  let newState = {} as State
  for (let prop in state) {
    let val = state[prop]
    newState[prop] = (val instanceof Array ? val.slice() : val) as any
  }
  return newState
}

export type LegacyMode<State> = {name: string} & StreamParserSpec<State>

export class StreamSyntax extends Syntax {
  private field: StateField<SyntaxState<any>>
  public extension: StateExtension
  public indentation: StateExtension

  constructor(name: string, readonly parser: StreamParser<any>, slots: Slot[] = []) {
    super(name, slots.concat(tokenTypes(tokenMap)))
    this.field = new StateField<SyntaxState<any>>({
      init(state) { return new SyntaxState(Tree.empty, [parser.startState(state)], 1, 0, null) },
      apply(tr, value) { return value.apply(tr) }
    })
    this.extension = StateExtension.all(syntax(this), this.field.extension)
    this.indentation = StateExtension.indentation((state: EditorState, pos: number) => {
      return state.getField(this.field).getIndent(this.parser, state, pos)
    })
  }

  getTree(state: EditorState, from: number, to: number): Tree {
    return state.getField(this.field).getTree(this.parser, state, to)
  }

  static legacy(mode: LegacyMode<any>): StreamSyntax {
    return new StreamSyntax(mode.name, new StreamParser(mode))
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

  findState(parser: StreamParser<ParseState>, editorState: EditorState, line: number) {
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
        parser.blankLine(state, editorState)
      } else {
        while (!stream.eol()) parser.readToken(state, stream, editorState)
      }
      this.maybeStoreState(parser, l, state)
    }
    return state
  }

  highlightUpto(parser: StreamParser<ParseState>, editorState: EditorState, to: number) {
    let state = this.frontierState || this.findState(parser, editorState, this.frontierLine)
    if (!state) return // FIXME make up a state? return a partial temp tree?
    // FIXME interrupt at some point when too much work is done
    let cursor = new StringStreamCursor(editorState.doc, this.frontierPos, editorState.tabSize)
    let buffer: number[] = []
    let line = this.frontierLine, pos = this.frontierPos
    while (pos < to) {
      let stream = cursor.next(), offset = cursor.offset
      if (stream.eol()) {
        parser.blankLine(state, editorState)
      } else {
        while (!stream.eol()) {
          let type = parser.readToken(state, stream, editorState)
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

  getIndent(parser: StreamParser<ParseState>, state: EditorState, pos: number) {
    let line = state.doc.lineAt(pos)
    let parseState = this.findState(parser, state, line.number)
    if (parseState == null) return -1
    let text = line.slice(pos - line.start, Math.min(line.end, pos + 100) - line.start)
    return parser.indent(parseState, /^\s*(.*)/.exec(text)![1], state)
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

export function legacyMode(spec: LegacyMode<any>) {
  let syntax = StreamSyntax.legacy(spec)
  // FIXME add behavior for commenting, electric chars, etc
  return StateExtension.all(
    syntax.extension,
    syntax.indentation
  )
}
