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
                                                   {class: 'cm-' + style.replace(/ /g, ' cm-')}))
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

  let plugin = new Plugin({
    state: field,
    view(v: EditorView) {
      let decorations = Decoration.none, from = -1, to = -1
      function update(v: EditorView, force: boolean) {
        let vp = v.viewport
        if (force || vp.from < from || vp.to > to) {
          ;({from, to} = vp)
          decorations = v.state.getField(field)!.getDecorations(from, to)
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
    let {pos: statePos, state: modeState} = state.getField(field)!.getStateBefore(pos)
    let cursor = new StringStreamCursor(state.doc.iterRange(statePos), statePos)
    let stream = cursor.next()
    modeState = modeState ? copyState(mode, modeState) : mode.startState()
    while (statePos < pos) {
      if (stream.eol()) {
        stream = cursor.next()
        statePos++
      } else {
        readToken(mode, stream, modeState)
        statePos += stream.pos - stream.start
        stream.start = stream.pos
      }        
    }
    return mode.indent(modeState, stream.string.slice(stream.pos))
  }

  return plugin
}
