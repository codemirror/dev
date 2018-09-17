import {EditorView} from "../../view/src"
import {Range} from "../../rangeset/src/rangeset"
import {EditorState, Plugin, StateField, Transaction} from "../../state/src"
import {Decoration} from "../../view/src/decoration"

import {StringStreamCursor} from "./stringstreamcursor"
import {copyState, readToken, Mode} from "./util"

class CachedState<S> {
  constructor(public state: S, public pos: number) {}
  copy(mode: Mode<S>) { return new CachedState(copyState(mode, this.state), this.pos) }
}

const MAX_SCAN_DIST = 20000

type DecoratedRange = Range<ReadonlyArray<Range<Decoration>>>

class StateCache<S> {
  constructor(private states: CachedState<S>[], private frontier: number, private lastDecorations: null | DecoratedRange) {}

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
      if (upto < to) {
        upto = this.lastDecorations.to
        decorations = decorations.concat(this.lastDecorations.value)
      }
    }
    if (upto < to) {
      decorations = decorations.concat(this.calculateDecorations(editorState, upto, to, mode))
    }
    this.lastDecorations = new Range(from, to, decorations)
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
    let start = transaction.changes.changes.reduce((m, ch) => Math.min(m, ch.from), 1e9)
    let states = []
    for (let cached of this.states) {
      let mapped = transaction.changes.mapPos(cached.pos, -1, true)
      if (mapped > 0) states.push(mapped == cached.pos ? cached : new CachedState(cached.state, mapped))
    }
    const lastDecorationsTill = transaction.doc.lineStartAt(start)
    return new StateCache(states, Math.min(start, this.frontier), lastDecorationsTill <= this.lastDecorations.from ? null : new Range(this.lastDecorations.from, Math.min(lastDecorationsTill, this.lastDecorations.to), this.lastDecorations.value.filter(({from}) => from <= lastDecorationsTill)))
  }
}

export function legacyMode<S>(mode: Mode<S>) {
  const field = new StateField<StateCache<S>>({
    init(state: EditorState) { return new StateCache([], 0, null) },
    apply(tr, cache) { return cache.apply(tr) },
    debugName: "mode"
  })

  let plugin = new Plugin({
    state: field,
    view(v: EditorView) {
      let decorations = Decoration.none, from = -1, to = -1
      function update(v: EditorView, force: boolean) {
        let vp = v.viewport
        if (force || vp.from < from || vp.to > to) {
          ;({from, to} = vp)
          decorations = Decoration.set(v.state.getField(field)!.getDecorations(v.state, from, to, mode))
        }
      }
      return {
        get decorations() { return decorations },
        updateViewport: update,
        updateState: (v: EditorView, p: EditorState, trs: Transaction[]) => update(v, trs.some(tr => tr.docChanged))
      }
    }
  })

  // FIXME Short-term hack—it'd be nice to have a better mechanism for this,
  // not sure yet what it'd look like
  ;(plugin as any).indentation = function(state: EditorState, pos: number): number {
    if (!mode.indent) return -1
    let modeState = state.getField(field)!.getState(state, pos, mode)
    return mode.indent(modeState, state.doc.slice(pos, state.doc.lineEndAt(pos)).match(/^\s*(.*)/)![1])
  }

  return plugin
}
