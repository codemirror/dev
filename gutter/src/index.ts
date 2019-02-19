import {combineConfig} from "../../extension/src/extension"
import {EditorView, ViewExtension, ViewPlugin, styleModule, viewPlugin, BlockType, BlockInfo} from "../../view/src"
import {StyleModule} from "style-mod"

// FIXME Think about how the gutter width changing could cause
// problems when line wrapping is on by changing a line's height
// (solution is possibly some way for this plugin to signal the view
// that it has to do another layout check when the gutter's width
// changes, which should be relatively rare)

// FIXME at some point, add support for custom gutter space and
// per-line markers

// FIXME seriously slow on Firefox when devtools are open

interface CompleteGutterConfig {
  fixed: boolean,
  formatNumber: (lineNo: number) => string
}
export type GutterConfig = Partial<CompleteGutterConfig>

export const gutter = ViewExtension.unique<GutterConfig>(configs => {
  let config = combineConfig(configs, {
    fixed: true,
    formatNumber: String
  })
  return ViewExtension.all(
    viewPlugin(view => new GutterView(view, config)),
    styleModule(styles)
  )
}, {})

class GutterView implements ViewPlugin {
  dom: HTMLElement
  spaceAbove: number = 0
  lines: GutterLine[] = []
  lastLine: GutterLine
  formatNumber: (lineNo: number) => string

  constructor(public view: EditorView, config: CompleteGutterConfig) {
    this.dom = document.createElement("div")
    this.dom.className = "codemirror-gutter " + styles.gutter
    this.dom.setAttribute("aria-hidden", "true")
    this.dom.style.cssText = `left: 0; box-sizing: border-box; height: 100%; overflow: hidden; flex-shrink: 0;`
    if (config.fixed) {
      // FIXME IE11 fallback, which doesn't support position: sticky,
      // by using position: relative + event handlers that realign the
      // gutter (or just force fixed=false on IE11?)
      this.dom.style.position = "sticky"
    }
    view.dom.insertBefore(this.dom, view.contentDOM)
    this.formatNumber = config.formatNumber
    this.lastLine = new GutterLine(1, 0, 0, this.formatNumber)
    this.lastLine.dom.style.cssText += "visibility: hidden; pointer-events: none"
    this.dom.appendChild(this.lastLine.dom)
    this.update()
  }

  update() {
    // Create the first number consisting of all 9s that is at least
    // as big as the line count, and put that in this.lastLine to make
    // sure the gutter width is stable
    let last = 9
    while (last < this.view.state.doc.lines) last = last * 10 + 9
    this.lastLine.update(last, 0, 0, this.formatNumber)
    // FIXME would be nice to be able to recognize updates that didn't redraw
    this.updateGutter()
  }

  updateGutter() {
    let i = 0, height = 0
    this.view.viewportLines(line => {
      let text: BlockInfo | undefined
      if (Array.isArray(line.type)) text = line.type.find(b => b.type == BlockType.Text)
      else text = line.type == BlockType.Text ? line : undefined
      if (!text) return
      let above = text.top - height
      // FIXME optimize (increment) when we can tell it's valid? (no replaced ranges)
      let lineNo = this.view.state.doc.lineAt(text.from).number
      if (i == this.lines.length) {
        let newLine = new GutterLine(lineNo, text.height, above, this.formatNumber)
        this.lines.push(newLine)
        this.dom.appendChild(newLine.dom)
      } else {
        this.lines[i].update(lineNo, text.height, above, this.formatNumber)
      }
      height = text.bottom
      i++
    }, 0)
    while (this.lines.length > i) this.dom.removeChild(this.lines.pop()!.dom)
    this.dom.style.minHeight = this.view.contentHeight + "px"
  }

  destroy() {
    this.dom.remove()
  }

  get styles() { return styles }
}

class GutterLine {
  dom: HTMLElement
  lineNo: number = -1
  height: number = -1
  above: number = 0
  below: number = 0

  constructor(lineNo: number, height: number, above: number, formatNo: (lineNo: number) => string) {
    this.dom = document.createElement("div")
    this.dom.className = "codemirror-gutter-element"
    this.update(lineNo, height, above, formatNo)
  }

  update(lineNo: number, height: number, above: number, formatNo: (lineNo: number) => string) {
    if (this.lineNo != lineNo)
      this.dom.textContent = formatNo(this.lineNo = lineNo)
    if (this.height != height)
      this.dom.style.height = (this.height = height) + "px"
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
  }
}

const styles = new StyleModule({
  gutter: {
    background: "#f5f5f5",
    borderRight: "1px solid silver",
    display: "flex !important", // Necessary -- prevents margin collapsing
    flexDirection: "column",

    "& > .codemirror-gutter-element": {
      boxSizing: "border-box",
      // FIXME these are line number specific
      padding: "0 3px 0 5px",
      minWidth: "20px",
      textAlign: "right",
      color: "#999",
      whiteSpace: "nowrap"
    }
  }
})
