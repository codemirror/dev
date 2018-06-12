import {Text} from "../../doc/src/text"

function visiblePixelRange(dom: HTMLElement): {top: number, bottom: number} {
  let rect = dom.getBoundingClientRect()
  let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
  for (let parent = dom.parentNode as any; parent;) { // (Cast to any because TypeScript is useless with Node types)
    if (parent.nodeType == 1) {
      if (parent.scrollHeight > parent.clientHeight) {
        let parentRect = parent.getBoundingClientRect()
        top = Math.max(top, parentRect.top)
        bottom = Math.min(bottom, parentRect.bottom)
      }
      parent = parent.parentNode
    } else if (parent.nodeType == 11) { // Shadow root
      parent = parent.host
    } else {
      break
    }
  }
  return {top: top - rect.top, bottom: bottom - rect.top}
}

// This is all a crude approximation to get started on this, I'm sure
// I'll figure out something a little more accurate later on
const LINE_HEIGHT = 14

// FIXME make these actually reliable. Take collapsed decorations into account

function visibleStart(doc: Text, top: number): number {
  return doc.lineStart(Math.max(1, Math.min(doc.lines, Math.floor(top / LINE_HEIGHT) + 1)))
}

function visibleEnd(doc: Text, bottom: number): number {
  let line = Math.max(1, Math.min(doc.lines, Math.floor(bottom / LINE_HEIGHT) + 1))
  return line == doc.lines ? doc.length : doc.lineStart(line + 1) - 1
}

const VIEWPORT_MARGIN = 500 // FIXME look into appropriate value of this through benchmarking etc

export class ViewportState {
  top: number = 0;
  bottom: number = 0;

  updateFromDOM(dom: HTMLElement) {
    ;({top: this.top, bottom: this.bottom} = visiblePixelRange(dom))
  }

  getViewport(doc: Text): Viewport {
    let start = visibleStart(doc, this.top - VIEWPORT_MARGIN)
    let end = visibleEnd(doc, this.bottom + VIEWPORT_MARGIN)
    return new Viewport(start, end)
  }

  coveredBy(doc: Text, viewport: Viewport) {
    let topLine = doc.linePos(viewport.from).line, bottomLine = doc.linePos(viewport.to).line
    let top = (topLine - 1) * LINE_HEIGHT, bottom = bottomLine * LINE_HEIGHT
    return top <= this.top && bottom >= this.bottom
  }
}

export class Viewport {
  constructor(readonly from: number, readonly to: number) {}
  eq(other: Viewport): boolean { return this.from == other.from && this.to == other.to }
  clip(pos: number): number { return Math.max(this.from, Math.min(this.to, pos)) }
}
