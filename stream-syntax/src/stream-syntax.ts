import {StringStream, StringStreamCursor} from "./stringstream"
import {EditorState, StateField, Transaction, Syntax, CancellablePromise} from "../../state"
import {Extension} from "../../extension"
import {Tree, NodeType, NodeProp, NodeGroup} from "lezer-tree"
import {defaultTags} from "../../highlight"

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
  token(stream: StringStream, state: State, editorState: EditorState): string | null
  /// This notifies the parser of a blank line in the input. It can
  /// update its state here if it needs to.
  blankLine?(state: State, editorState: EditorState): void
  /// Produce a start state for the parser.
  startState?(editorState: EditorState): State
  /// Copy a given state. By default, a shallow object copy is done
  /// which also copies arrays held at the top level of the object.
  copyState?(state: State): State
  /// Compute automatic indentation for the line that starts with the
  /// given state and text.
  indent?(state: State, textAfter: string, editorState: EditorState): number
  /// Syntax [node
  /// props](https://lezer.codemirror.net/docs/ref#tree.NodeProp) to
  /// be added to the wrapper node created around syntax 'trees'
  /// created by this syntax.
  docProps?: readonly [NodeProp<any>, any][]
}

class StreamParserInstance<State> {
  token: (stream: StringStream, state: State, editorState: EditorState) => string | null
  blankLine: (state: State, editorState: EditorState) => void
  // FIXME maybe support passing something from the parent when nesting
  startState: (editorState: EditorState) => State
  copyState: (state: State) => State
  indent: (state: State, textAfter: string, editorState: EditorState) => number
  docType: number
  
  constructor(spec: StreamParser<State>) {
    this.token = spec.token
    this.blankLine = spec.blankLine || (() => {})
    this.startState = spec.startState || (() => (true as any))
    this.copyState = spec.copyState || defaultCopyState
    this.indent = spec.indent || (() => -1)
    this.docType = docID(spec.docProps || [])
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

class RequestInfo {
  promise: CancellablePromise<Tree>
  resolve!: (tree: Tree) => void

  constructor(readonly upto: number) {
    this.promise = new Promise<Tree>(r => this.resolve = r)
    this.promise.canceled = false
  }
}

/// A syntax provider that uses a stream parser.
export class StreamSyntax implements Syntax {
  private field: StateField<SyntaxState<any>>
  /// The extension that installs this syntax provider.
  public extension: Extension
  private parser: StreamParserInstance<any>

  /// Create a stream syntax.
  constructor(parser: StreamParser<any>) {
    this.parser = new StreamParserInstance(parser)
    this.field = new StateField<SyntaxState<any>>({
      init: state => new SyntaxState(Tree.empty, [this.parser.startState(state)], 1, 0, null),
      apply: (tr, value) => value.apply(tr)
    })
    this.extension = [
      EditorState.syntax(this),
      this.field.extension,
      EditorState.indentation((state: EditorState, pos: number) => {
        return state.field(this.field).getIndent(this.parser, state, pos)
      })
    ]
  }

  tryGetTree(state: EditorState, from: number, to: number) {
    let field = state.field(this.field)
    return field.updateTree(this.parser, state, to, false) ? field.tree : null
  }

  getTree(state: EditorState, from: number, to: number) {
    let field = state.field(this.field)
    let rest = field.updateTree(this.parser, state, to, true) as CancellablePromise<Tree> | true
    return {tree: field.tree, rest: rest === true ? null : rest}
  }

  getPartialTree(state: EditorState, from: number, to: number) {
    let field = state.field(this.field)
    field.updateTree(this.parser, state, to, false)
    return field.tree
  }

  docTypeAt(state: EditorState, pos: number) {
    return typeArray[this.parser.docType]
  }
}

const CACHE_STEP_SHIFT = 6, CACHE_STEP = 1 << CACHE_STEP_SHIFT

const MAX_RECOMPUTE_DISTANCE = 20e3

const WORK_SLICE = 100, WORK_PAUSE = 200

class SyntaxState<ParseState> {
  requests: RequestInfo[] = []
  working = -1

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

  maybeStoreState(parser: StreamParserInstance<ParseState>, lineBefore: number, state: ParseState) {
    if (lineBefore % CACHE_STEP == 0)
      this.cache[(lineBefore - 1) >> CACHE_STEP_SHIFT] = parser.copyState(state)
  }

  findState(parser: StreamParserInstance<ParseState>, editorState: EditorState, line: number) {
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

  advanceFrontier(parser: StreamParserInstance<ParseState>, editorState: EditorState, upto: number) {
    let state = this.frontierState || this.findState(parser, editorState, this.frontierLine)!
    let sliceEnd = Date.now() + WORK_SLICE
    let cursor = new StringStreamCursor(editorState.doc, this.frontierPos, editorState.tabSize)
    let buffer: number[] = []
    let line = this.frontierLine, pos = this.frontierPos
    while (pos < upto) {
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
      if (Date.now() > sliceEnd) break
    }
    let tree = Tree.build(buffer, nodeGroup, parser.docType).balance()
    this.tree = this.tree.append(tree).balance()
    this.frontierLine = line
    this.frontierPos = pos
    this.frontierState = state
  }

  updateTree(parser: StreamParserInstance<ParseState>, state: EditorState, upto: number,
             rest: boolean): boolean | CancellablePromise<Tree> {
    // FIXME make sure multiple calls in same frame don't keep doing work
    if (this.frontierPos >= upto) return true
    if (this.working == -1) this.advanceFrontier(parser, state, upto)
    if (this.frontierPos >= upto) return true
    if (!rest) return false
    let req = this.requests.find(r => r.upto == upto && !r.promise.canceled)
    if (!req) {
      req = new RequestInfo(upto)
      this.requests.push(req)
    }
    this.scheduleWork(parser, state)
    return req.promise
  }

  scheduleWork(parser: StreamParserInstance<ParseState>, state: EditorState) {
    if (this.working != -1) return
    this.working = setTimeout(() => this.work(parser, state), WORK_PAUSE) as any
  }

  work(parser: StreamParserInstance<ParseState>, state: EditorState) {
    this.working = -1
    let upto = this.requests.reduce((max, req) => req.promise.canceled ? max : Math.max(max, req.upto), 0)
    if (upto > this.frontierPos) this.advanceFrontier(parser, state, upto)

    this.requests = this.requests.filter(req => {
      if (req.upto > this.frontierPos && !req.promise.canceled) return true
      if (!req.promise.canceled) req.resolve(this.tree)
      return false
    })
    if (this.requests.length) this.scheduleWork(parser, state)
  }

  getIndent(parser: StreamParserInstance<ParseState>, state: EditorState, pos: number) {
    let line = state.doc.lineAt(pos)
    let parseState = this.findState(parser, state, line.number)
    if (parseState == null) return -1
    let text = line.slice(pos - line.start, Math.min(line.end, pos + 100) - line.start)
    return parser.indent(parseState, /^\s*(.*)/.exec(text)![1], state)
  }
}

const tokenTable: {[name: string]: number} = Object.create(null)
const typeArray: NodeType[] = [NodeType.none]
const nodeGroup = new NodeGroup(typeArray)
const warned: string[] = []

function tokenID(tag: string): number {
  let id = tokenTable[tag]
  if (id == null) {
    let tagID = 0
    try {
      tagID = defaultTags.get(tag)
    } catch(e) {
      if (!(e instanceof RangeError)) throw e
      if (warned.indexOf(tag) < 0) {
        warned.push(tag)
        console.warn(`'${tag}' is not a valid style tag`)
      }
      return tokenID("")
    }
    id = tokenTable[tag] = typeArray.length
    typeArray.push(new NodeType(tag ? tag.replace(/ /g, "_") : "_", defaultTags.prop.set({}, tagID), id))
  }
  return id
}

function docID(props: readonly [NodeProp<any>, any][]) {
  if (props.length == 0) return tokenID("")
  let obj = Object.create(null)
  for (let [prop, value] of props) prop.set(obj, value)
  let id = typeArray.length
  typeArray.push(new NodeType("document", obj, id))
  return id
}
