// This is a temporary, simplified version of the mode plugin, which
// handles huge documents better. Doesn't always highlight accurately.

import {EditorView} from "../../view/src"
import {Text} from "../../doc/src/text"
import {Range} from "../../rangeset/src/rangeset"
import {EditorState, Plugin, StateField, Transaction} from "../../state/src"
import {Decoration} from "../../view/src/decoration"

import {StringStreamCursor} from "./stringstreamcursor"
import {copyState, readToken, Mode} from "./util"

class CachedState {
  constructor(public state: any, public pos: number) {}
  copy(mode: Mode<any>) { return new CachedState(copyState(mode, this.state), this.pos) }
}

const MAX_SCAN_DIST = 20000

class StateCache {
  constructor(private states: CachedState[], private frontier: number) {}

  getDecorations<S>(doc: Text, from: number, to: number, mode: Mode<any>): Range<Decoration>[] {
    let state = this.getState(doc, from, mode)
    let cursor = new StringStreamCursor(doc.iterRange(from, to), from)
    let states: CachedState[] = [], decorations: Range<Decoration>[] = [], stream = cursor.next()
    for (let i = 0, pos = from; pos < to;) {
      if (stream.eol()) {
        pos++
        stream = cursor.next()
        if (++i % 5 == 0) states.push(new CachedState(copyState(mode, state), pos))
      } else {
        let style = readToken(mode, stream, state), len = stream.pos - stream.start
        if (style)
          decorations.push(Decoration.range(pos, pos + len, {class: 'cm-' + style.replace(/ /g, ' cm-')}))
        stream.start = stream.pos
        pos += len
      }
    }
    this.storeStates(from, to, states)
    return decorations
  }

  storeStates(from: number, to: number, states: CachedState[]) {
    let start = this.findIndex(from), end = this.findIndex(to)
    this.states.splice(start, end - start, ...states)
    if (from < this.frontier) this.frontier = Math.max(this.frontier, to)
  }

  // Return the first index for which all cached states after it have
  // a position >= pos
  findIndex(pos: number): number {
    // FIXME could be binary search
    let i = 0
    for (; i < this.states.length && this.states[i].pos >= pos; i++) {}
    return i
  }

  // FIXME use frontier/staleness, somehow
  stateBefore(pos: number, mode: Mode<any>): {state: any, pos: number} {
    let index = this.findIndex(pos)
    if (index < this.states.length && this.states[index].pos == pos) index++
    return index == 0 ? new CachedState(mode.startState(), 0) : this.states[index - 1].copy(mode)
  }

  getState(doc: Text, pos: number, mode: Mode<any>): any {
    let {pos: statePos, state} = this.stateBefore(pos, mode)
    if (statePos < pos - MAX_SCAN_DIST) { statePos = pos; state = mode.startState() }
    if (statePos < pos) {
      let cursor = new StringStreamCursor(doc.iterRange(statePos), statePos)
      let stream = cursor.next()
      while (statePos < pos) {
        if (stream.eol()) {
          stream = cursor.next()
          statePos++
        } else {
          readToken(mode, stream, state)
          statePos += stream.pos - stream.start
          stream.start = stream.pos
        }
      }
    }
    return state
  }

  apply(transaction: Transaction) {
    if (transaction.changes.length == 0) return this
    let start = transaction.changes.changes.reduce((m, ch) => Math.min(m, ch.from), 1e9)
    let states = []
    for (let cached of this.states) {
      let mapped = transaction.changes.mapPos(cached.pos, -1, true)
      if (mapped > 0) states.push(mapped == cached.pos ? cached : new CachedState(cached.state, mapped))
    }
    return new StateCache(states, Math.min(start, this.frontier))
  }
}

export function legacyMode<S>(mode: Mode<S>) {
  const field = new StateField<StateCache>({
    init(state: EditorState) { return new StateCache([], 0) },
    apply(tr, cache) { return cache.apply(tr) }
  })

  let plugin = new Plugin({
    state: field,
    view(v: EditorView) {
      let decorations = Decoration.none, from = -1, to = -1
      function update(v: EditorView, force: boolean) {
        let vp = v.viewport
        if (force || vp.from < from || vp.to > to) {
          ;({from, to} = vp)
          decorations = Decoration.set(v.state.getField(field)!.getDecorations(v.state.doc, from, to, mode))
        }
      }
      return {
        get decorations() { return decorations },
        updateViewport: update,
        updateState: (v: EditorView) => update(v, true)
      }
    }
  })

  // FIXME Short-term hack—it'd be nice to have a better mechanism for this,
  // not sure yet what it'd look like
  ;(plugin as any).indentation = function(state: EditorState, pos: number): number {
    if (!mode.indent) return -1
    let modeState = state.getField(field)!.getState(state.doc, pos, mode)
    return mode.indent(modeState, state.doc.slice(pos, state.doc.lineEndAt(pos)).match(/^\s*(.*)/)![1])
  }

  return plugin
}
