import {EditorView, ViewUpdate, ViewExtension} from "../../view/src"
import {Range} from "../../rangeset/src/rangeset"
import {EditorState, StateExtension, StateField, Transaction} from "../../state/src"
import {Decoration} from "../../view/src/decoration"

import {StringStreamCursor} from "./stringstreamcursor"
import {copyState, readToken, Mode} from "./util"

class CachedState<S> {
  constructor(public state: S, public pos: number) {}
  copy(mode: Mode<S>) { return new CachedState(copyState(mode, this.state), this.pos) }
}

const MAX_SCAN_DIST = 20000

type DecoratedRange = {from: number, to: number, decorations: ReadonlyArray<Range<Decoration>>}

function cutDecoratedRange(range: DecoratedRange | null, at: number) {
  if (!range || at <= range.from) return null
  return {from: range.from, to: Math.min(at, range.to), decorations: range.decorations.filter(({to}) => to <= at)}
}

class StateCache<S> {
  private timeout?: number | NodeJS.Timer

  constructor(private states: CachedState<S>[], private frontier: number, private lastDecorations: null | DecoratedRange) {}

  advanceFrontier(editorState: EditorState, to: number, mode: Mode<S>, sleepTime: number, maxWorkTime: number): Promise<void> {
    if (this.frontier >= to) return Promise.reject()
    clearTimeout(this.timeout as any)
    return new Promise(resolve => {
      const f = () => {
        const endTime = +new Date + maxWorkTime
        do {
          const target = Math.min(to, this.frontier + MAX_SCAN_DIST / 2)
          this.getState(editorState, target, mode)
          if (this.frontier >= to) return resolve()
        } while (+new Date < endTime)
        this.timeout = setTimeout(f, sleepTime)
      }
      this.timeout = setTimeout(f, sleepTime)
    })
  }

  private calculateDecorations(editorState: EditorState, from: number, to: number, mode: Mode<S>): Range<Decoration>[] {
    let state = this.getState(editorState, from, mode)
    let cursor = new StringStreamCursor(editorState.doc, from, editorState.tabSize)
    let states: CachedState<S>[] = [], decorations: Range<Decoration>[] = [], stream = cursor.next()
    for (let i = 0; cursor.offset + stream.start < to;) {
      if (stream.eol()) {
        stream = cursor.next()
        if (++i % 5 == 0) states.push(new CachedState(copyState(mode, state), cursor.offset))
      } else {
        let style = readToken(mode, stream, state)
        if (style)
          decorations.push(Decoration.range(cursor.offset + stream.start, cursor.offset + stream.pos, {class: 'cm-' + style.replace(/ /g, ' cm-')}))
        stream.start = stream.pos
      }
    }
    this.storeStates(from, to, states)
    return decorations
  }

  getDecorations(editorState: EditorState, from: number, to: number, mode: Mode<S>): Range<Decoration>[] {
    let upto = from, decorations: Range<Decoration>[] = []
    if (this.lastDecorations) {
      if (from < this.lastDecorations.from) {
        upto = Math.min(to, this.lastDecorations.from)
        decorations = this.calculateDecorations(editorState, from, upto, mode)
      }
      if (upto < to && this.lastDecorations.to > upto) {
        upto = this.lastDecorations.to
        decorations = decorations.concat(this.lastDecorations.decorations)
      }
    }
    if (upto < to) {
      decorations = decorations.concat(this.calculateDecorations(editorState, upto, to, mode))
    }
    this.lastDecorations = {from, to, decorations}
    return decorations
  }

  storeStates(from: number, to: number, states: ReadonlyArray<CachedState<S>>) {
    let start = this.findIndex(from), end = this.findIndex(to)
    this.states.splice(start, end - start, ...states)
    if (from <= this.frontier) this.frontier = Math.max(this.frontier, to)
  }

  // Return the first index for which all cached states after it have
  // a position >= pos
  findIndex(pos: number): number {
    // FIXME could be binary search
    let i = 0
    while (i < this.states.length && this.states[i].pos < pos) i++
    return i
  }

  stateBefore(pos: number, mode: Mode<S>): {state: S, pos: number} {
    if (pos > this.frontier && pos - this.frontier < MAX_SCAN_DIST) pos = this.frontier
    let index = this.findIndex(pos)
    if (index < this.states.length && this.states[index].pos == pos) index++
    return index == 0 ? new CachedState(mode.startState(), 0) : this.states[index - 1].copy(mode)
  }

  getState(editorState: EditorState, pos: number, mode: Mode<S>): S {
    let {pos: statePos, state} = this.stateBefore(pos, mode)
    if (statePos < pos - MAX_SCAN_DIST) { statePos = pos; state = mode.startState() }
    else if (this.lastDecorations && (statePos < this.lastDecorations.from && this.lastDecorations.from <= pos))
      // If we are calculating a correct state for a position that is after the
      // beginning of the cached decorations (which suggests that the cached
      // decorations were rendered based on an approximate state), clear that cache
      this.lastDecorations = null
    if (statePos < pos) {
      let cursor = new StringStreamCursor(editorState.doc, statePos, editorState.tabSize)
      let stream = cursor.next()
      let start = statePos, i = 0, states: CachedState<S>[] = []
      while (statePos < pos) {
        if (stream.eol()) {
          stream = cursor.next()
          statePos++
          if (++i % 50) states.push(new CachedState(copyState(mode, state), statePos))
        } else {
          readToken(mode, stream, state)
          statePos += stream.pos - stream.start
          stream.start = stream.pos
        }
      }
      this.storeStates(start, pos, states)
    }
    return state
  }

  apply(transaction: Transaction): StateCache<S> {
    if (transaction.changes.length == 0) return this
    let {start} = transaction.doc.lineAt(transaction.changes.changes.reduce((m, ch) => Math.min(m, ch.from), 1e9))
    let states = []
    for (let cached of this.states) {
      let mapped = transaction.changes.mapPos(cached.pos, -1, true)
      if (mapped > 0) states.push(mapped == cached.pos ? cached : new CachedState(cached.state, mapped))
    }
    return new StateCache(states, Math.min(start, this.frontier), cutDecoratedRange(this.lastDecorations, start))
  }
}

type Config = {
  sleepTime?: number,
  maxWorkTime?: number,
  mode: Mode<any>
}

export const legacyMode = (config: Config) => {
  let field = new StateField<StateCache<any>>({
    init(state: EditorState) { return new StateCache([], 0, null) },
    apply(tr, cache) { return cache.apply(tr) },
    name: "mode"
  })
  return StateExtension.all(
    field.extension,
    ViewExtension.decorations(decoSpec(field, config)),
    StateExtension.indentation((state: EditorState, pos: number): number => {
      if (!config.mode.indent) return -1
      let modeState = state.getField(field).getState(state, pos, config.mode)
      let line = state.doc.lineAt(pos)
      return config.mode.indent(modeState, line.slice(0, Math.min(line.length, 100)).match(/^\s*(.*)/)![1])
    })
    // FIXME add a token-retrieving behavior
  )
}

function decoSpec(field: StateField<StateCache<any>>, config: Config) {
  const {sleepTime = 100, maxWorkTime = 100, mode} = config
  let decorations = Decoration.none, from = -1, to = -1
  function update(v: EditorView, force: boolean) {
    let vp = v.viewport
    if (force || vp.from < from || vp.to > to) {
      ;({from, to} = vp)
      const stateCache = v.state.getField(field)!
      decorations = Decoration.set(stateCache.getDecorations(v.state, from, to, mode))
      stateCache.advanceFrontier(v.state, from, mode, sleepTime, maxWorkTime).then(() => {
        update(v, true)
        v.updateState([], v.state) // FIXME maybe add a specific EditorView method for this
      }, () => {})
    }
    return decorations
  }
  return {
    create(view: EditorView) { return update(view, false) },
    update(view: EditorView, {transactions}: ViewUpdate) { return update(view, transactions.some(tr => tr.docChanged)) }
  }
}
