import {Parser, InputStream, ParseContext} from "lezer"
import {Tree, Subtree, NodeProp, ChangedRange} from "lezer-tree"
import {Text, TextIterator} from "@codemirror/next/text"
import {EditorState, StateField, Transaction, Syntax, Extension, StateEffect, StateEffectType} from "@codemirror/next/state"
import {ViewPlugin, ViewUpdate, EditorView} from "@codemirror/next/view"
import {syntaxIndentation} from "./indent"
import {syntaxFolding} from "./fold"

/// A [syntax provider](#state.Syntax) based on a
/// [Lezer](https://lezer.codemirror.net) parser.
export class LezerSyntax implements Syntax {
  readonly field: StateField<SyntaxState>
  /// The extension value to install this provider.
  readonly extension: Extension

  /// Create a syntax instance for the given parser. You'll usually
  /// want to use the
  /// [`withProps`](https://lezer.codemirror.net/docs/ref/#lezer.Parser.withProps)
  /// method to register CodeMirror-specific syntax node props in the
  /// parser, before passing it to this constructor.
  constructor(readonly parser: Parser) {
    let setSyntax = StateEffect.define<SyntaxState>()
    this.field = StateField.define<SyntaxState>({
      create(state) { return SyntaxState.advance(Tree.empty, parser, state.doc) },
      update(value, tr, state) { return value.apply(tr, state, parser, setSyntax) }
    })
    this.extension = [
      EditorState.syntax.of(this),
      this.field,
      ViewPlugin.define(view => new HighlightWorker(view, this, setSyntax)),
      syntaxIndentation(this),
      syntaxFolding(this)
    ]
  }

  getTree(state: EditorState) {
    return state.field(this.field).tree
  }

  parsePos(state: EditorState) {
    return state.field(this.field).upto
  }

  ensureTree(state: EditorState, upto: number, timeout = 100): Tree | null {
    let field = state.field(this.field)
    if (field.upto >= upto) return field.updatedTree
    if (!field.parse) field.startParse(this.parser, state.doc)

    if (field.parse!.pos < upto) {
      let done = work(field.parse!, timeout, upto)
      if (done) return field.stopParse(done, state.doc.length)
    }

    return field.parse!.pos < upto ? null : field.stopParse()
  }

  get docNodeType() { return this.parser.topType }

  docNodeTypeAt(state: EditorState, pos: number) {
    let type = this.docNodeType
    if (this.parser.hasNested) {
      let tree = this.getTree(state)
      let target: Subtree | null = tree.resolve(pos)
      while (target) {
        if (target.type.prop(NodeProp.top)) return target.type
        target = target.parent
      }
    }
    return type
  }
}

class DocStream implements InputStream {
  cursor: TextIterator
  cursorPos = 0
  string = ""

  constructor(readonly doc: Text, readonly length: number = doc.length) {
    this.cursor = doc.iter()
  }

  get(pos: number) {
    if (pos >= this.length) return -1
    let stringStart = this.cursorPos - this.string.length
    if (pos < stringStart || pos >= this.cursorPos) {
      if (pos < this.cursorPos) { // Reset the cursor if we have to go back
        this.cursor = this.doc.iter()
        this.cursorPos = 0
      }
      this.string = this.cursor.next(pos - this.cursorPos).value
      this.cursorPos = pos + this.string.length
      stringStart = this.cursorPos - this.string.length
    }
    return this.string.charCodeAt(pos - stringStart)
  }

  read(from: number, to: number) {
    let stringStart = this.cursorPos - this.string.length
    if (from < stringStart || to >= this.cursorPos)
      return this.doc.sliceString(from, to)
    else
      return this.string.slice(from - stringStart, to - stringStart)
  }

  clip(at: number) {
    return new DocStream(this.doc, at)
  }
}

const enum Work {
  // Milliseconds of work time to perform immediately for a state doc change
  Apply = 25,
  // Minimum amount of work time to perform in an idle callback
  MinSlice = 25,
  // Amount of work time to perform in pseudo-thread when idle callbacks aren't supported
  Slice = 100,
  // Maximum pause (timeout) for the pseudo-thread
  Pause = 200,
  // Don't parse beyond this point unless explicitly requested to with `ensureTree`.
  MaxPos = 5e6
}

function work(parse: ParseContext, time: number, upto: number = Work.MaxPos) {
  let endTime = Date.now() + time
  for (;;) {
    let done = parse.advance()
    if (done) return done
    if (parse.pos > upto || Date.now() > endTime) return null
  }
}

function takeTree(parse: ParseContext, base: Tree) {
  let parsed = parse.forceFinish()
  let after = base.applyChanges([{fromA: 0, toA: parse.pos, fromB: 0, toB: parse.pos}])
  return parsed.append(after)
}

class SyntaxState {
  public updatedTree: Tree
  public parse: ParseContext | null = null

  constructor(public tree: Tree, public upto: number) {
    this.updatedTree = tree
  }

  static advance(tree: Tree, parser: Parser, doc: Text) {
    let parse = parser.startParse(new DocStream(doc), {cache: tree})
    let done = work(parse, Work.Apply)
    return done ? new SyntaxState(done, doc.length) : new SyntaxState(takeTree(parse, tree), parse.pos)
  }

  apply(tr: Transaction, newState: EditorState, parser: Parser, effect: StateEffectType<SyntaxState>) {
    for (let e of tr.effects) if (e.is(effect)) return e.value
    if (!tr.docChanged) return this
    let ranges: ChangedRange[] = []
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({fromA, toA, fromB, toB}))
    return SyntaxState.advance(
      (this.parse ? takeTree(this.parse, this.updatedTree) : this.updatedTree).applyChanges(ranges),
      parser, newState.doc)
  }

  startParse(parser: Parser, doc: Text) {
    this.parse = parser.startParse(new DocStream(doc), {cache: this.updatedTree})
  }

  stopParse(tree?: Tree | null, upto?: number) {
    if (!tree) tree = takeTree(this.parse!, this.updatedTree)
    this.updatedTree = tree
    this.upto = upto ?? this.parse!.pos
    this.parse = null
    return tree
  }
}

type Deadline = {timeRemaining(): number, didTimeout: boolean}
type IdleCallback = (deadline?: Deadline) => void

let requestIdle: (callback: IdleCallback, options: {timeout: number}) => number =
  typeof window != "undefined" && (window as any).requestIdleCallback ||
  ((callback: IdleCallback, {timeout}: {timeout: number}) => setTimeout(callback, timeout))
let cancelIdle: (id: number) => void = typeof window != "undefined" && (window as any).cancelIdleCallback || clearTimeout

// FIXME figure out some way to back off from full re-parses when the
// document is large—you could waste a lot of battery re-parsing a
// multi-megabyte document every time you insert a backtick, even if
// it happens in the background.

class HighlightWorker {
  working: number = -1

  constructor(readonly view: EditorView, 
              readonly syntax: LezerSyntax,
              readonly setSyntax: StateEffectType<SyntaxState>) {
    this.work = this.work.bind(this)
    this.scheduleWork()
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.scheduleWork()
  }

  scheduleWork() {
    if (this.working > -1) return
    let {state} = this.view, field = state.field(this.syntax.field)
    if (field.upto >= state.doc.length) return
    this.working = requestIdle(this.work, {timeout: Work.Pause})
  }

  work(deadline?: Deadline) {
    this.working = -1
    let {state} = this.view, field = state.field(this.syntax.field)
    if (field.upto >= state.doc.length) return
    if (!field.parse) field.startParse(this.syntax.parser, state.doc)
    let done = work(field.parse!, deadline ? Math.max(Work.MinSlice, deadline.timeRemaining()) : Work.Slice)
    if (done || field.parse!.badness > .8)
      this.view.dispatch(state.update({
        effects: this.setSyntax.of(new SyntaxState(
          field.stopParse(done, state.doc.length), state.doc.length))
      }))
    else
      this.scheduleWork()
  }

  destroy() {
    if (this.working >= 0) cancelIdle(this.working)
  }
}
