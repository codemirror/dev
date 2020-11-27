import {StringStream} from "./stringstream"
import {Tree, TreeFragment, NodeType, NodeProp, NodeSet} from "lezer-tree"
import {IncrementalParser, IncrementalParse, Input} from "lezer"
import {Tag, tags, styleTags} from "@codemirror/next/highlight"

export {StringStream}

/// A stream parser parses or tokenizes content from start to end,
/// emitting tokens as it goes over it. It keeps a mutable (but
/// copyable) object with state, in which it can store information
/// about the current context.
export type StreamParserSpec<State> = {
  /// Read one token, advancing the stream past it, and returning a
  /// string with the token's style. It is okay to return an empty
  /// token, but only if that updates the state so that the next call
  /// will return a token again.
  token(stream: StringStream, state: State): string | null
  /// This notifies the parser of a blank line in the input. It can
  /// update its state here if it needs to.
  blankLine?(state: State): void
  /// Produce a start state for the parser.
  startState?(): State
  /// Copy a given state. By default, a shallow object copy is done
  /// which also copies arrays held at the top level of the object.
  copyState?(state: State): State
  /// Compute automatic indentation for the line that starts with the
  /// given state and text.
  indent?(state: State, textAfter: string): number | null
  /// Syntax [node
  /// props](https://lezer.codemirror.net/docs/ref#tree.NodeProp) to
  /// be added to the wrapper node created around syntax 'trees'
  /// created by this syntax.
  docProps?: readonly [NodeProp<any>, any][]
}

function fullSpec<State>(spec: StreamParserSpec<State>): Required<StreamParserSpec<State>> {
  return {
    token: spec.token,
    blankLine: spec.blankLine || (() => {}),
    startState: spec.startState || (() => (true as any)),
    copyState: spec.copyState || defaultCopyState,
    indent: spec.indent || (() => null),
    docProps: spec.docProps || []
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

// FIXME somehow smuggle the indentation service into the config
/*
  getIndent(parser: StreamParserInstance<ParseState>, state: EditorState, pos: number) {
    let line = state.doc.lineAt(pos)
    let parseState = this.findState(parser, state, line.number)
    if (parseState == null) return -1
    let text = line.slice(pos - line.from, Math.min(line.to, pos + 100) - line.from)
    return parser.indent(parseState, /^\s*(.*)/.exec(text)![1], state)
  }
*/

// FIXME limit parse distance, stop at end of viewport
// const MaxRecomputeDistance = 20e3

export class StreamParser<State> implements IncrementalParser {
  /// @internal
  spec: Required<StreamParserSpec<State>>
  /// @internal
  docType: number
  /// @internal
  stateAfter = new WeakMap<Tree, State>() // FIXME store lookahead distance

  constructor(spec: StreamParserSpec<State>) {
    this.spec = fullSpec(spec)
    this.docType = docID(this.spec.docProps)
  }

  startParse(input: Input, options?: {fragments?: readonly TreeFragment[], startPos?: number}): IncrementalParse {
    return new Parse(this, input, options?.startPos || 0, options?.fragments)
  }
}

function findStart<State>(parser: StreamParser<State>, fragments: readonly TreeFragment[] | undefined, startPos: number) {
  if (fragments) for (let f of fragments) if (f.from <= startPos && f.to > startPos) {
    let find = (tree: Tree, off: number): {state: State, tree: Tree} | null => {
      let state = parser.stateAfter.get(tree)
      if (state) return {state, tree}
      for (let i = tree.children.length - 1; i >= 0; i--) {
        let child = tree.children[i], pos, found
        if (child instanceof Tree && (pos = tree.positions[i] + off) >= f.from &&
            pos + child.length <= f.to && (found = find(child, pos))) {
          if (off < startPos) return found
          return {
            state: found.state,
            tree: new Tree(tree.type, tree.children.slice(0, i).concat(found.tree),
                           tree.positions.slice(0, i + 1), pos + found.tree.length - off)
          }
        }
      }
      return null
    }
    let found = find(f.tree, f.offset)
    if (found) return found
  }
  return {state: parser.spec.startState(), tree: Tree.empty}
}

const enum Chunk { Size = 2048 }

class Parse<State> {
  state: State
  pos: number
  chunks: Tree[] = []
  chunkPos: number[] = []
  chunkStart: number
  chunk: number[] = []

  constructor(readonly parser: StreamParser<State>,
              readonly input: Input,
              readonly startPos: number,
              fragments?: readonly TreeFragment[]) {
    let {state, tree} = findStart(parser, fragments, startPos)
    this.state = state
    this.pos = this.chunkStart = startPos + tree.length
    if (tree.length) {
      this.chunks.push(tree)
      this.chunkPos.push(startPos)
    }
  }

  advance() {
    let end = Math.min(this.input.length, this.chunkStart + Chunk.Size)
    while (this.pos < end) this.parseLine()
    if (this.chunkStart < this.pos) this.finishChunk()
    if (this.pos == this.input.length) return this.finish()
    return null
  }

  parseLine() {
    let line = this.input.lineAfter(this.pos), {spec} = this.parser
    let stream = new StringStream(line, 4 /* FIXME how do we get tabSize? what if it changes? Ughhh */)
    if (stream.eol()) {
      spec.blankLine(this.state)
    } else {
      while (!stream.eol()) {
        let token = readToken(spec.token, stream, this.state)
        if (token)
          this.chunk.push(tokenID(token), this.pos + stream.start, this.pos + stream.pos, 4)
      }
    }
    this.pos += line.length
    if (this.pos < this.input.length) this.pos++
  }

  finishChunk() {
    let tree = Tree.build({
      buffer: this.chunk,
      start: this.chunkStart,
      length: this.pos - this.chunkStart,
      nodeSet,
      topID: 0,
      maxBufferLength: Chunk.Size
    })
    this.parser.stateAfter.set(tree, this.parser.spec.copyState(this.state))
    this.chunks.push(tree)
    this.chunkPos.push(this.chunkStart)
    this.chunk = []
    this.chunkStart = this.pos
  }

  finish() {
    return new Tree(typeArray[this.parser.docType], this.chunks, this.chunkPos, this.startPos - this.pos).balance()
  }

  forceFinish() {
    return this.finish()
  }
}

function readToken<State>(token: (stream: StringStream, state: State) => string | null,
                          stream: StringStream,
                          state: State) {
  stream.start = stream.pos
  for (let i = 0; i < 10; i++) {
    let result = token(stream, state)
    if (stream.pos > stream.start) return result
  }
  throw new Error("Stream parser failed to advance stream.")
}

// FIXME move to returning tag objects
const tokenTable: {[name: string]: number} = Object.create(null)
const typeArray: NodeType[] = [NodeType.none]
const nodeSet = new NodeSet(typeArray)
const warned: string[] = []

function tokenID(tag: string): number {
  return !tag ? 0 : tokenTable[tag] || (tokenTable[tag] = createTokenType(tag))
}

function warnForPart(part: string, msg: string) {
  if (warned.indexOf(part) > -1) return
  warned.push(part)
  console.warn(msg)
}

function createTokenType(tagStr: string) {
  let tag = null
  for (let part of tagStr.split(" ")) {
    let value = (tags as any)[part]
    if (!value) {
      warnForPart(part, `Unknown highlighting tag ${part}`)
    } else if (typeof value == "function") {
      if (!tag) warnForPart(part, `Modifier ${part} used at start of tag`)
      else tag = value(tag) as Tag
    } else {
      if (tag) warnForPart(part, `Tag ${part} used as modifier`)
      else tag = value as Tag
    }
  }
  if (!tag) return 0

  let name = tagStr.replace(/ /g, "_"), type = NodeType.define({
    id: typeArray.length,
    name,
    props: [styleTags({[name]: tag})]
  })
  typeArray.push(type)
  return type.id
}

function docID(props: readonly [NodeProp<any>, any][]) {
  if (props.length == 0) return tokenID("")
  let obj = Object.create(null)
  for (let [prop, value] of props) prop.set(obj, value)
  let id = typeArray.length
  typeArray.push(new (NodeType as any)("document", obj, id))
  return id
}
