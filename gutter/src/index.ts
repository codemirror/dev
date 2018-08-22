import {Plugin} from "../../state/src"
import {EditorView} from "../../view/src"

// FIXME Think about how the gutter width changing could cause
// problems when line wrapping is on by changing a line's height
// (solution is possibly some way for this plugin to signal the view
// that it has to do another layout check when the gutter's width
// changes, which should be relatively rare)

// FIXME at some point, add support for custom gutter space and
// per-line markers

// FIXME seriously slow on Firefox, quite fast on Chrome

export interface GutterConfig {
  fixed?: boolean,
  formatNumber?: (lineNo: number) => string
}

export function gutter(config: GutterConfig = {}) {
  return new Plugin({
    view(view: EditorView) { return new GutterView(view, config) }
  })
}

class GutterView {
  dom: HTMLElement
  spaceAbove: number = 0
  lines: GutterLine[] = []
  lastLine: GutterLine
  formatNumber: (lineNo: number) => string

  constructor(view: EditorView, config: GutterConfig) {
    this.dom = document.createElement("div")
    this.dom.className = "CodeMirror-gutter"
    this.dom.setAttribute("aria-hidden", "true")
    this.dom.style.cssText = `left: 0; box-sizing: border-box; height: 100%; overflow: hidden`
    if (config.fixed !== false) {
      // FIXME IE11 fallback, which doesn't support position: sticky,
      // by using position: relative + event handlers that realign the
      // gutter (or just force fixed=false on IE11?)
      this.dom.style.position = "sticky"
    }
    view.dom.insertBefore(this.dom, view.contentDOM)
    this.formatNumber = config.formatNumber || String
    this.lastLine = new GutterLine(1, 0, this.formatNumber)
    this.lastLine.dom.style.cssText += "visibility: hidden; pointer-events: none"
    this.dom.appendChild(this.lastLine.dom)
    this.updateDOM(view)
  }

  updateDOM(view: EditorView) {
    // Create the first number consisting of all 9s that is at least
    // as big as the line count, and put that in this.lastLine to make
    // sure the gutter width is stable
    let last = 9
    while (last < view.state.doc.lines) last = last * 10 + 9
    this.lastLine.update(last, 0, this.formatNumber)
    // FIXME would be nice to be able to recognize updates that didn't redraw
    this.updateGutter(view)
  }

  updateGutter(view: EditorView) {
    let spaceAbove = view.heightAtPos(view.viewport.from, true)
    if (spaceAbove != this.spaceAbove) {
      this.spaceAbove = spaceAbove
      this.dom.style.paddingTop = spaceAbove + "px"
    }
    let i = 0, lineNo = -1
    view.viewport.forEachLine((from, to, line) => {
      if (lineNo < 0) lineNo = view.state.doc.linePos(from).line
      if (i == this.lines.length) {
        let newLine = new GutterLine(lineNo, line.height, this.formatNumber)
        this.lines.push(newLine)
        this.dom.appendChild(newLine.dom)
      } else {
        this.lines[i].update(lineNo, line.height, this.formatNumber)
      }
      lineNo = line.hasCollapsedRanges ? -1 : lineNo + 1
      i++
    })
    while (this.lines.length > i) this.dom.removeChild(this.lines.pop()!.dom)
    this.dom.style.minHeight = view.contentHeight + "px"
  }
}

class GutterLine {
  dom: HTMLElement
  lineNo: number = -1
  height: number = -1

  constructor(lineNo: number, height: number, formatNo: (lineNo: number) => string) {
    this.dom = document.createElement("div")
    this.dom.className = "CodeMirror-gutter-element"
    this.update(lineNo, height, formatNo)
  }

  update(lineNo: number, height: number, formatNo: (lineNo: number) => string) {
    if (this.lineNo != lineNo) {
      this.lineNo = lineNo
      this.dom.textContent = formatNo(lineNo)
    }
    if (this.height != height) {
      this.height = height
      this.dom.style.height = height + "px"
    }
  }
}
