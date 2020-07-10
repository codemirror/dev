import {StringStream, StringStreamCursor} from "./stringstream"
import {EditorState, StateField, Syntax, Extension, StateEffect, StateEffectType, IndentContext,
        Facet, languageDataProp} from "@codemirror/next/state"
import {EditorView, ViewPlugin, PluginValue, ViewUpdate} from "@codemirror/next/view"
import {Tree, NodeType, NodeProp, NodeGroup} from "lezer-tree"
import {defaultTags} from "@codemirror/next/highlight"

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
  startState: (es: EditorState) => State
  copyState: (state: State) => State
  indent: (state: State, textAfter: string, editorState: EditorState) => number
  docType: number

  constructor(spec: StreamParser<State>, languageData: Facet<{[name: string]: any}>) {
    this.token = spec.token
    this.blankLine = spec.blankLine || (() => {})
    this.startState = spec.startState || (() => (true as any))
    this.copyState = spec.copyState || defaultCopyState
    this.indent = spec.indent || (() => -1)
    this.docType = docID((spec.docProps || []).concat([[languageDataProp, languageData]]))
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

/// A syntax provider that uses a stream parser.
export class StreamSyntax implements Syntax {
  private field: StateField<SyntaxState<any>>
  /// The extension that installs this syntax provider.
  public extension: Extension
  private parser: StreamParserInstance<any>
  public languageData: Facet<{[name: string]: any}>

  /// Create a stream syntax.
  constructor(parser: StreamParser<any>) {
    this.languageData = Facet.define<{[name: string]: any}>()
    let parserInst = this.parser = new StreamParserInstance(parser, this.languageData)
    let setSyntax = StateEffect.define<SyntaxState<any>>()
    this.field = StateField.define<SyntaxState<any>>({
      create(state) {
        let start = new SyntaxState(Tree.empty, [parserInst.startState(state)], 1, 0, null)
        start.advanceFrontier(parserInst, state, Work.Apply)
        start.tree = start.updatedTree
        return start
      },
      update(value, tr) {
        for (let effect of tr.effects) if (effect.is(setSyntax)) return effect.value
        if (!tr.docChanged) return value
        let changeStart = -1
        tr.changes.iterChangedRanges(from => changeStart = changeStart < 0 ? from : changeStart)
        let {from, number} = tr.state.doc.lineAt(changeStart)
        let newValue = number >= value.frontierLine ? value.copy() : value.cut(number, from)
        newValue.advanceFrontier(parserInst, tr.state, Work.Apply)
        newValue.tree = newValue.updatedTree
        return newValue
      }
    })
    this.extension = [
      EditorState.syntax.of(this),
      ViewPlugin.define(view => new HighlightWorker(view, this.parser, this.field, setSyntax)),
      this.field,
      EditorState.indentation.of((context: IndentContext, pos: number) => {
        return context.state.field(this.field).getIndent(this.parser, context.state, pos)
      })
    ]
  }

  getTree(state: EditorState) {
    return state.field(this.field).tree
  }

  parsePos(state: EditorState) {
    return state.field(this.field).frontierPos
  }

  ensureTree(state: EditorState, upto: number, timeout = 100) {
    let field = state.field(this.field)
    if (field.frontierPos < upto)
      field.advanceFrontier(this.parser, state, timeout, upto)
    return field.frontierPos < upto ? null : field.updatedTree
  }

  // FIXME allow modes to extend this?
  languageDataFacetAt() { return this.languageData }
}

const CacheStepShift = 6, CacheStep = 1 << CacheStepShift

const MaxRecomputeDistance = 20e3

const enum Work { Apply = 25, MinSlice = 50, Slice = 100, Pause = 200 }

class SyntaxState<ParseState> {
  working = -1
  updatedTree: Tree

  constructor(public tree: Tree,
              // Slot 0 stores the start state (line 1), slot 1 the
              // state at the start of line 65, etc, so lineNo ==
              // (index * CACHE_STEP) + 1
              public cache: ParseState[],
              public frontierLine: number,
              public frontierPos: number,
              public frontierState: ParseState | null) {
    this.updatedTree = tree
  }

  copy() {
    return new SyntaxState(this.updatedTree, this.cache.slice(), this.frontierLine, this.frontierPos, this.frontierState)
  }

  cut(line: number, pos: number) {
    return new SyntaxState(this.updatedTree.cut(pos), this.cache.slice(0, (line >> CacheStepShift) + 1), line, pos, null)
  }

  maybeStoreState(parser: StreamParserInstance<ParseState>, lineBefore: number, state: ParseState) {
    if (lineBefore % CacheStep == 0)
      this.cache[(lineBefore - 1) >> CacheStepShift] = parser.copyState(state)
  }

  findState(parser: StreamParserInstance<ParseState>, editorState: EditorState, line: number) {
    let cacheIndex = Math.min(this.cache.length - 1, (line - 1) >> CacheStepShift)
    let cachedLine = (cacheIndex << CacheStepShift) + 1
    let startPos = editorState.doc.line(cachedLine).from
    if (line - cachedLine > CacheStep && editorState.doc.line(line).from - startPos > MaxRecomputeDistance)
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

  advanceFrontier(parser: StreamParserInstance<ParseState>, editorState: EditorState, timeout: number,
                  upto: number = editorState.doc.length) {
    if (this.frontierPos >= editorState.doc.length) return
    let sliceEnd = Date.now() + timeout
    let state = this.frontierState || this.findState(parser, editorState, this.frontierLine)!
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
    let tree = Tree.build({buffer,
                           group: nodeGroup,
                           topID: parser.docType}).balance()
    this.updatedTree = this.updatedTree.append(tree).balance()
    this.frontierLine = line
    this.frontierPos = pos
    this.frontierState = state
  }

  getIndent(parser: StreamParserInstance<ParseState>, state: EditorState, pos: number) {
    let line = state.doc.lineAt(pos)
    let parseState = this.findState(parser, state, line.number)
    if (parseState == null) return -1
    let text = line.slice(pos - line.from, Math.min(line.to, pos + 100) - line.from)
    return parser.indent(parseState, /^\s*(.*)/.exec(text)![1], state)
  }
}

type Deadline = {timeRemaining(): number, didTimeout: boolean}
type IdleCallback = (deadline?: Deadline) => void

let requestIdle: (callback: IdleCallback, options: {timeout: number}) => number =
  typeof window != "undefined" && (window as any).requestIdleCallback ||
  ((callback: IdleCallback, {timeout}: {timeout: number}) => setTimeout(callback, timeout))
let cancelIdle: (id: number) => void = typeof window != "undefined" && (window as any).cancelIdleCallback || clearTimeout

class HighlightWorker implements PluginValue {
  working: number = -1

  constructor(readonly view: EditorView,
              readonly parser: StreamParserInstance<any>,
              readonly field: StateField<SyntaxState<any>>,
              readonly setSyntax: StateEffectType<SyntaxState<any>>) {
    this.work = this.work.bind(this)
    this.scheduleWork()
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.scheduleWork()
  }

  scheduleWork() {
    if (this.working > -1) return
    let {state} = this.view, field = state.field(this.field)
    if (field.frontierPos >= state.doc.length) return
    this.working = requestIdle(this.work, {timeout: Work.Pause})
  }

  work(deadline?: Deadline) {
    this.working = -1
    let {state} = this.view, field = state.field(this.field)
    if (field.frontierPos >= state.doc.length) return
    // Advance to the end of the viewport, and no further, by default
    let end = this.view.viewport.to
    field.advanceFrontier(this.parser, state, deadline ? Math.max(Work.MinSlice, deadline.timeRemaining()) : Work.Slice, end)
    if (field.frontierPos < end) this.scheduleWork()
    else this.view.dispatch({effects: this.setSyntax.of(field.copy())})
  }

  destroy() {
    if (this.working >= 0) cancelIdle(this.working)
  }
}

const tokenTable: {[name: string]: number} = Object.create(null)
const typeArray: NodeType[] = [NodeType.none]
const nodeGroup = new NodeGroup(typeArray)
const warned: string[] = []

function tokenID(tag: string): number {
  let id = tokenTable[tag]
  if (id == null) {
    let props = {}
    try {
      props = defaultTags.addTagProp(tag, props)
    } catch(e) {
      if (!(e instanceof RangeError)) throw e
      if (warned.indexOf(tag) < 0) {
        warned.push(tag)
        console.warn(`'${tag}' is not a valid style tag`)
      }
      return tokenID("")
    }
    id = tokenTable[tag] = typeArray.length
    typeArray.push(new NodeType(tag ? tag.replace(/ /g, "_") : "_", props, id))
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
