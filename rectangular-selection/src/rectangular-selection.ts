import {Extension, EditorSelection, EditorState} from "@codemirror/next/state"
import {EditorView, MouseSelectionStyle} from "@codemirror/next/view"
import {countColumn, findColumn} from "@codemirror/next/text"

type Pos = {line: number, col: number, off: number}

// Don't compute precise column positions for line offsets above this
// (since it could get expensive). Assume offset==column for them.
const MaxOff = 2000

function rectangleFor(state: EditorState, a: Pos, b: Pos) {
  let startLine = Math.min(a.line, b.line), endLine = Math.max(a.line, b.line)
  let ranges = []
  if (a.off > MaxOff || b.off > MaxOff || a.col < 0 || b.col < 0) {
    let startOff = Math.min(a.off, b.off), endOff = Math.max(a.off, b.off)
    for (let i = startLine; i <= endLine; i++) {
      let line = state.doc.line(i)
      if (line.length <= endOff)
        ranges.push(EditorSelection.range(line.from + startOff, line.to + endOff))
    }
  } else {
    let startCol = Math.min(a.col, b.col), endCol = Math.max(a.col, b.col)
    for (let i = startLine; i <= endLine; i++) {
      let line = state.doc.line(i), str = line.length > MaxOff ? line.slice(0, 2 * endCol) : line.slice()
      let start = findColumn(str, 0, startCol, state.tabSize), end = findColumn(str, 0, endCol, state.tabSize)
      if (!start.leftOver)
        ranges.push(EditorSelection.range(line.from + start.offset, line.from + end.offset))
    }
  }
  return ranges
}

function absoluteColumn(view: EditorView, x: number) {
  let ref = view.coordsAtPos(view.viewport.from)
  return ref ? Math.round(Math.abs((ref.left - x) / view.defaultCharacterWidth)) : -1
}

function getPos(view: EditorView, event: MouseEvent) {
  let offset = view.posAtCoords({x: event.clientX, y: event.clientY}) // FIXME
  let line = view.state.doc.lineAt(offset), off = offset - line.from
  let col = off > MaxOff ? -1
    : off == line.length ? absoluteColumn(view, event.clientX)
    : countColumn(line.slice(0, offset - line.from), 0, view.state.tabSize)
  return {line: line.number, col, off}
}

function rectangleSelectionStyle(view: EditorView, event: MouseEvent) {
  let start = getPos(view, event), startSel = view.state.selection
  return {
    update(update) {
      if (update.docChanged) {
        let newStart = update.changes.mapPos(update.prevState.doc.line(start.line).from)
        let newLine = update.state.doc.lineAt(newStart)
        start = {line: newLine.number, col: start.col, off: Math.min(start.off, newLine.length)}
        startSel = startSel.map(update.changes)
      }
    },
    get(event, _extend, multiple) {
      let cur = getPos(view, event), ranges = rectangleFor(view.state, start, cur)
      if (!ranges.length) return startSel
      if (multiple) return EditorSelection.create(ranges.concat(startSel.ranges))
      else return EditorSelection.create(ranges)
    }
  } as MouseSelectionStyle
}

/// Create an extension that enables rectangular selections. By
/// default, it will rect to left mouse drag with the alt key held
/// down. When such a selection occurs, the text within the rectangle
/// that was dragged over will be selected, as one selection
/// [range](#state.SelectionRange) per line. You can pass a custom
/// predicate function, which takes a `mousedown` event and returns
/// true if it should be used for rectangular selection.
export function rectangularSelection(eventFilter?: (event: MouseEvent) => boolean): Extension {
  let filter = eventFilter || (e => e.altKey && e.button == 0)
  return EditorView.mouseSelectionStyle.of((view, event) => filter(event) ? rectangleSelectionStyle(view, event) : null)
}
