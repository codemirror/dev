import {Text} from "../../doc/src/text"
import {EditorState, Plugin, StateField} from "../../state/src"
import {Decoration, DecorationSet} from "../../view/src/decoration"

import {StringStream} from "./StringStream"
import {IteratorStringStream} from "./IteratorStringStream"

type State = boolean | {[{key: string}]: any}

type Mode<S> = {
  token(stream: StringStream, state: S): string,
  copyState?: (state: S) => S,
  name: string
}

function readToken<S>(mode: Mode<S>, stream: StringStream, state: S, inner = null) {
  for (let i = 0; i < 10; i++) {
    //if (inner) inner[0] = innerMode(mode, state).mode
    let style = mode.token(stream, state)
    if (stream.pos > stream.start) return style
  }
  throw new Error("Mode " + mode.name + " failed to advance stream.")
}

function copyState<S>(mode: Mode<S>, state: S) {
  if (state === true) return state
  if (mode.copyState) return mode.copyState(state)
  let nstate = {}
  for (let n in state) {
    let val = state[n]
    if (val instanceof Array) val = val.concat([])
    nstate[n] = val
  }
  return nstate
}

// TODO
// Implement all the tricks for faster highlighting:
// - keep everything above change
// - keep everything after change with same start state
// - don't highlight outside viewport?

function getDecorations<S>(mode: Mode<S>, doc: Text): DecorationSet {
  const decorations = []
  let state = mode.startState()
  const stream = new IteratorStringStream(doc)
  while (!stream.eof()) {
    while (!stream.eol()) {
      const style = readToken(mode, stream, state)
      if (style) decorations.push(Decoration.range(stream.start + stream.offset, stream.pos + stream.offset,
                                                   {attributes: {class: 'cm-' + style.replace(/ /g, ' cm-')}}))
      stream.start = stream.pos
    }
    stream.nextLine()
    state = copyState(mode, state)
  }
  return Decoration.set(decorations)
}

export function legacyMode<S>(mode: Mode<S>) {
  const field = new StateField<DecorationSet>({
    init(state: EditorState) { return getDecorations(mode, state.doc) },
    apply(tr, decos) { return getDecorations(mode, tr.doc) } // decos.map(tr.changes) }
  })

  return new Plugin({
    state: field,
    view(v) {
      return {
        get decorations() { return v.state.getField(field) }
      }
    }
  })
}
