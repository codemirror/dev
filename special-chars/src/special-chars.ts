import {Decoration, DecoratedRange, DecorationSet, WidgetType, EditorView} from "../../view/src"
import {Transaction, ChangeSet, ChangedRange, Plugin} from "../../state/src"

export interface SpecialCharOptions {
  
}

class Options {
  constructor(given: SpecialCharOptions) {}
}

export function specialChars(options: SpecialCharOptions): Plugin {
  return new Plugin({
    view(view: EditorView) {
      return new SpecialCharHighlighter(view, new Options(options))
    }
  })
}

const JOIN_GAP = 10

class SpecialCharHighlighter {
  decorations: DecorationSet = Decoration.none
  from = 0
  to = 0

  constructor(readonly view: EditorView, readonly options: Options) {
    this.updateForViewport()
  }

  updateState(_view: EditorView, _prev: any, transactions: Transaction[]) {
    let allChanges = transactions.reduce((ch, tr) => ch.appendSet(tr.changes), ChangeSet.empty)
    if (allChanges.length) {
      this.decorations = this.decorations.map(allChanges)
      this.from = allChanges.mapPos(this.from, 1)
      this.to = allChanges.mapPos(this.to, -1)
      this.closeHoles(allChanges.changedRanges())
    }
    this.updateForViewport()
  }

  updateViewport() {
    this.updateForViewport()
  }

  closeHoles(ranges: ReadonlyArray<ChangedRange>) {
    let decorations: DecoratedRange[] = [], vp = this.view.viewport
    for (let i = 0; i < ranges.length; i++) {
      let {fromB: from, toB: to} = ranges[i]
      while (i < ranges.length - 1 && ranges[i + 1].fromB < to + JOIN_GAP) to = ranges[++i].toB
      // Clip to current viewport, to avoid doing work for invisible text
      from = Math.max(vp.from, from); to = Math.min(vp.to, to)
      if (from >= to) continue
      this.getDecorationsFor(from, to, decorations)
    }
    if (decorations.length) this.decorations = this.decorations.update(decorations)
  }

  updateForViewport() {
    let vp = this.view.viewport
    // Viewports match, don't do anything
    if (this.from == vp.from && this.to == vp.to) return
    let decorations: DecoratedRange[] = []
    if (this.from >= vp.to || this.to <= vp.from) {
      this.getDecorationsFor(vp.from, vp.to, decorations)
      this.decorations = Decoration.set(decorations)
    } else {
      if (vp.from < this.from) this.getDecorationsFor(vp.from, this.from, decorations)
      if (this.to < vp.to) this.getDecorationsFor(this.to, vp.to, decorations)
      this.decorations = this.decorations.update(decorations, (from, to) => from >= vp.from && to <= vp.to)
    }
    this.from = vp.from; this.to = vp.to
  }

  getDecorationsFor(from: number, to: number, target: DecoratedRange[]) {
    for (let pos = from, cursor = this.view.state.doc.iterRange(from, to), m; !cursor.next().done;) {
      if (!cursor.lineBreak) {
        while (m = SPECIALS.exec(cursor.value)) {
          target.push(Decoration.range(pos + m.index, pos + m.index + 1, {
            collapsed: new SpecialCharWidget(this.options, m[0].charCodeAt(0))
          }))
        }
      }
      pos += cursor.value.length
    }
  }
}

// FIXME configurable
const SPECIALS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff]/g

const NAMES: {[key: number]: string} = {
  0: "null",
  7: "bell",
  8: "backspace",
  9: "tab",
  10: "newline",
  11: "vertical tab",
  13: "carriage return",
  27: "escape",
  8203: "zero width space",
  8204: "zero width non-joiner",
  8205: "zero width joiner",
  8206: "left-to-right mark",
  8207: "right-to-left mark",
  8232: "line separator",
  8233: "paragraph separator",
  65279: "zero width no-break space"
}

// Assigns placeholder characters from the Control Pictures block to
// ASCII control characters
function placeHolder(code: number): string | null {
  if (code >= 32) return null
  if (code == 10) return "\u2424"
  return String.fromCharCode(9216 + code)
}

const DEFAULT_PLACEHOLDER = "\u2022"

class SpecialCharWidget extends WidgetType<number> {
  constructor(_options: Options, code: number) { super(code) }

  toDOM() { // FIXME tab
    let span = document.createElement("span")
    span.textContent = placeHolder(this.spec) || DEFAULT_PLACEHOLDER
    let title = "Control character " + (NAMES[this.spec] || this.spec)
    span.title = title
    span.setAttribute("aria-label", title)
    span.style.color = "red"
    return span
  }
}
