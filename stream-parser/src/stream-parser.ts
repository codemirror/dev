import {Tree, TreeFragment, NodeType, NodeProp, NodeSet, SyntaxNode, IncrementalParse} from "lezer-tree"
import {Input} from "lezer"
import {Tag, tags, styleTags} from "@codemirror/next/highlight"
import {Language, defineLanguageFacet, languageDataProp, IndentContext, indentService, ParseContext} from "@codemirror/next/language"
import {StringStream} from "./stringstream"

export {StringStream}

/// A stream parser parses or tokenizes content from start to end,
/// emitting tokens as it goes over it. It keeps a mutable (but
/// copyable) object with state, in which it can store information
/// about the current context.
export type StreamParser<State> = {
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
  indent?(state: State, textAfter: string, context: IndentContext): number | null
  /// Syntax [node
  /// props](https://lezer.codemirror.net/docs/ref#tree.NodeProp) to
  /// be added to the wrapper node created around syntax 'trees'
  /// created by this syntax.
  docProps?: readonly [NodeProp<any>, any][],
  /// Default [language data](#state.EditorState.languageDataAt) to
  /// attach to this language.
  languageData?: {[name: string]: any}
}

function fullParser<State>(spec: StreamParser<State>): Required<StreamParser<State>> {
  return {
    token: spec.token,
    blankLine: spec.blankLine || (() => {}),
    startState: spec.startState || (() => (true as any)),
    copyState: spec.copyState || defaultCopyState,
    indent: spec.indent || (() => null),
    docProps: spec.docProps || [],
    languageData: spec.languageData || {}
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

// FIXME limit parse distance, stop at end of viewport
// const MaxRecomputeDistance = 20e3

export class StreamLanguage<State> extends Language {
  /// @internal
  streamParser: Required<StreamParser<State>>
  /// @internal
  docType: number
  /// @internal
  stateAfter: WeakMap<Tree, State>

  private constructor(parser: StreamParser<State>) {
    let data = defineLanguageFacet(parser.languageData)
    let p = fullParser(parser)
    let startParse = (input: Input, startPos = 0, context?: ParseContext) => new Parse(this, input, startPos, context)
    super(data, {startParse}, [indentService.of((cx, pos) => this.getIndent(cx, pos))])
    this.streamParser = p
    this.docType = docID(p.docProps.concat([[languageDataProp, data]]))
    this.stateAfter = new WeakMap
  }

  static define<State>(spec: StreamParser<State>) { return new StreamLanguage(spec) }

  private getIndent(cx: IndentContext, pos: number) {
    let tree = this.getTree(cx.state), at: SyntaxNode | null = tree.resolve(pos)
    while (at && at.type != typeArray[this.docType]) at = at.parent
    if (!at) return null
    let start = findState(this, tree, 0, at.from, pos), statePos, state
    if (start) { state = start.state; statePos = start.pos + 1 }
    else { state = this.streamParser.startState() ; statePos = 0 }
    if (pos - statePos > C.MaxIndentScanDist) return null
    while (statePos < pos) {
      let line = cx.state.doc.lineAt(statePos), end = Math.min(pos, line.to)
      if (line.length) {
        let stream = new StringStream(line.slice(), cx.state.tabSize)
        while (stream.pos < end - line.from)
          readToken(this.streamParser.token, stream, state)
      } else {
        this.streamParser.blankLine(state)
      }
      if (end == pos) break
      statePos = line.to + 1
    }
    let text = cx.state.doc.lineAt(pos).slice(0, 100)
    return this.streamParser.indent(state, /^\s*(.*)/.exec(text)![1], cx)
  }
}

function findState<State>(
  lang: StreamLanguage<State>, tree: Tree, off: number, startPos: number, before: number
): {state: State, pos: number} | null {
  if (off + tree.length >= before) return null
  let state = off >= startPos && lang.stateAfter.get(tree)
  if (state) return {state: lang.streamParser.copyState(state), pos: off + tree.length}
  for (let i = tree.children.length - 1; i >= 0; i--) {
    let child = tree.children[i], found = child instanceof Tree && findState(lang, child, off + tree.positions[i], startPos, before)
    if (found) return found
  }
  return null
}

function cutTree(lang: StreamLanguage<unknown>, tree: Tree, from: number, to: number, inside: boolean): Tree | null {
  if (!inside && tree.type == typeArray[lang.docType]) inside = true
  for (let i = 0; i < tree.children.length; i++) {
    let pos = tree.positions[i] + from, child = tree.children[i], end = pos + child.length, inner
    if (end >= to) {
      if (pos > from || !(child instanceof Tree) ||
          !(inner = cutTree(lang, child, from - pos, end - pos, inside))) return null
      return !inside ? inner 
        : new Tree(tree.type, tree.children.slice(0, i).concat(inner), tree.positions.slice(0, i + 1), pos + inner.length)
    }
  }
  return null
}

function findStartInFragments<State>(lang: StreamLanguage<State>, fragments: readonly TreeFragment[] | undefined, startPos: number) {
  if (fragments) for (let f of fragments) {
    let found = f.from <= startPos && f.to > startPos && findState(lang, f.tree, -f.offset, startPos, 1e9), tree
    if (found && (tree = cutTree(lang, f.tree, startPos + f.offset, found.pos + f.offset, false)))
      return {state: found.state, tree}
  }
  return {state: lang.streamParser.startState(), tree: Tree.empty}
}

const enum C {
  ChunkSize = 2048,
  MaxIndentScanDist = 10000
}

class Parse<State> implements IncrementalParse {
  state: State
  pos: number
  chunks: Tree[] = []
  chunkPos: number[] = []
  chunkStart: number
  chunk: number[] = []

  constructor(readonly lang: StreamLanguage<State>,
              readonly input: Input,
              readonly startPos: number,
              readonly context?: ParseContext) {
    let {state, tree} = findStartInFragments(lang, context?.fragments, startPos)
    this.state = state
    this.pos = this.chunkStart = startPos + tree.length
    if (tree.length) {
      this.chunks.push(tree)
      this.chunkPos.push(startPos)
    }
  }

  advance() {
    let end = Math.min(this.input.length, this.chunkStart + C.ChunkSize)
    while (this.pos < end) this.parseLine()
    if (this.chunkStart < this.pos) this.finishChunk()
    if (this.pos == this.input.length) return this.finish()
    return null
  }

  parseLine() {
    let line = this.input.lineAfter(this.pos), {streamParser} = this.lang
    let stream = new StringStream(line, this.context ? this.context.state.tabSize : 4)
    if (stream.eol()) {
      streamParser.blankLine(this.state)
    } else {
      while (!stream.eol()) {
        let token = readToken(streamParser.token, stream, this.state)
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
      maxBufferLength: C.ChunkSize
    })
    this.lang.stateAfter.set(tree, this.lang.streamParser.copyState(this.state))
    this.chunks.push(tree)
    this.chunkPos.push(this.chunkStart)
    this.chunk = []
    this.chunkStart = this.pos
  }

  finish() {
    return new Tree(typeArray[this.lang.docType], this.chunks, this.chunkPos, this.pos - this.startPos).balance()
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
