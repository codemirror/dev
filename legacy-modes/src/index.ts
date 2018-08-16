import {EditorView} from "../../view/src"
import {Text} from "../../doc/src/text"
import {Range} from "../../rangeset/src/rangeset"
import {EditorState, Plugin, StateField} from "../../state/src"
import {DecoratedRange, Decoration} from "../../view/src/decoration"

import {StringStreamCursor} from "./stringstreamcursor"
import {DecorationCache} from "./decorationcache"
import {copyState, readToken, Mode} from "./util"

function getDecorations<S>(mode: Mode<S>, doc: Text, from: number, to: number, state: S = mode.startState()): [ReadonlyArray<DecoratedRange>, ReadonlyArray<Range<S>>] {
  const decorations = []
  const states: Range<S>[] = []
  const cursor = new StringStreamCursor(doc.iterRange(from, to), from)
  let stream = cursor.next()
  const pushState = () => states.push(new Range(stream.pos + cursor.offset, stream.pos + cursor.offset, copyState(mode, state)))
  for (let line = 0; cursor.offset < to; stream = cursor.next(), ++line) {
    while (!stream.eol()) {
      const style = readToken(mode, stream, state)
      if (style) decorations.push(Decoration.range(stream.start + cursor.offset, stream.pos + cursor.offset,
                                                   {attributes: {class: 'cm-' + style.replace(/ /g, ' cm-')}}))
      stream.start = stream.pos
      if ((stream.pos + 1) % 4096 == 0) pushState()
    }
    if ((line + 1) % 5 == 0) pushState()
  }
  pushState()
  return [decorations, states]
}

export function legacyMode<S>(mode: Mode<S>) {
  const field = new StateField<DecorationCache<S>>({
    init(state: EditorState) { return new DecorationCache((doc, from, to, startState) => getDecorations(mode, doc, from, to, startState), state.doc) },
    apply(tr, state) { return state.update(tr) }
  })

  return new Plugin({
    state: field,
    view(v: EditorView) {
      let updateDocView = null, from, to
      return {
        get decorations() {
          ({from, to} = v.viewport)
          return v.state.getField(field)!.getDecorations(from, to)
        },
        layoutChange(v: EditorView) {
          if (updateDocView) clearTimeout(updateDocView)
          if (v.viewport.from < from || v.viewport.to > to)
            updateDocView = setTimeout(() => v.docView.update(v.state.doc, v.state.selection, v.decorations), 100)
        }
      }
    }
  })
}
