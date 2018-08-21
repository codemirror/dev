import {EditorView} from "../../view/src"
import {Text} from "../../doc/src/text"
import {EditorState, Plugin, StateField} from "../../state/src"
import {Decoration, DecorationSet} from "../../view/src/decoration"

import {StringStreamCursor} from "./stringstreamcursor"
import {copyState, readToken, Mode} from "./util"

function getDecorations<S>(mode: Mode<S>, doc: Text): DecorationSet {
  const decorations = []
  let state = mode.startState()
  const to = doc.length
  const cursor = new StringStreamCursor(doc.iter(), 0)
  while (cursor.offset < to) {
    const stream = cursor.next()
    while (!stream.eol()) {
      const style = readToken(mode, stream, state)
      if (style) decorations.push(Decoration.range(stream.start + cursor.offset, stream.pos + cursor.offset,
                                                   {class: 'cm-' + style.replace(/ /g, ' cm-')}))
      stream.start = stream.pos
    }
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
    view(v: EditorView) {
      return {
        get decorations() { return v.state.getField(field) }
      }
    }
  })
}
