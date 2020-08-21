import {EditorView, themeClass, ViewUpdate, Direction} from "@codemirror/next/view"
import {StateField} from "@codemirror/next/state"
import {TooltipView} from "@codemirror/next/tooltip"
import {CompletionState} from "./state"
import {Option, applyCompletion} from "./completion"
import {MaxInfoWidth} from "./theme"

function createListBox(options: readonly Option[], id: string) {
  const ul = document.createElement("ul")
  ul.id = id
  ul.setAttribute("role", "listbox")
  ul.setAttribute("aria-expanded", "true")
  for (let i = 0; i < options.length; i++) {
    let {completion, match} = options[i]
    const li = ul.appendChild(document.createElement("li"))
    li.id = id + "-" + i
    let icon = li.appendChild(document.createElement("div"))
    icon.className = themeClass("completionIcon" + (completion.type ? "." + completion.type : ""))
    let labelElt = li.appendChild(document.createElement("span"))
    labelElt.className = themeClass("completionLabel")
    let {label, detail} = completion, off = 0
    for (let j = 1; j < match.length;) {
      let from = match[j++], to = match[j++]
      if (from > off) labelElt.appendChild(document.createTextNode(label.slice(off, from)))
      let span = labelElt.appendChild(document.createElement("span"))
      span.appendChild(document.createTextNode(label.slice(from, to)))
      span.className = themeClass("completionMatchedText")
      off = to
    }
    if (off < label.length) labelElt.appendChild(document.createTextNode(label.slice(off)))
    if (detail) {
      let detailElt = li.appendChild(document.createElement("span"))
      detailElt.className = themeClass("completionDetail")
      detailElt.textContent = detail
    }
    li.setAttribute("role", "option")
  }
  return ul
}

function createInfoDialog(option: Option) {
  let dom = document.createElement("div")
  dom.className = themeClass("tooltip.completionInfo")
  let {info} = option.completion
  if (typeof info == "string") dom.textContent = info
  else dom.appendChild(info!(option.completion))
  return dom
}

class CompletionTooltip {
  dom: HTMLElement
  info: HTMLElement | null = null
  list: HTMLElement
  placeInfo = {
    read: () => this.measureInfo(),
    write: (pos: {left: boolean, top: number} | null) => this.positionInfo(pos),
    key: this
  }

  constructor(readonly view: EditorView,
              readonly options: readonly Option[],
              readonly id: string,
              readonly stateField: StateField<CompletionState>) {
    this.dom = document.createElement("div")
    this.list = this.dom.appendChild(createListBox(options, id))
    this.list.addEventListener("click", (e: MouseEvent) => {
      let index = 0, dom = e.target as HTMLElement | null
      for (;;) { dom = dom!.previousSibling as (HTMLElement | null); if (!dom) break; index++ }
      if (index < options.length) applyCompletion(view, options[index])
    })
    this.list.addEventListener("scroll", () => {
      if (this.info) this.view.requestMeasure(this.placeInfo)
    })
  }

  mount() { this.updateSel() }

  update(update: ViewUpdate) {
    if (update.state.field(this.stateField) != update.prevState.field(this.stateField))
      this.updateSel()
  }

  positioned() {
    if (this.info) this.view.requestMeasure(this.placeInfo)
  }

  updateSel() {
    let cState = this.view.state.field(this.stateField)
    if (cState.open) {
      if (this.updateSelectedOption(cState.open.selected)) {
        if (this.info) {this.info.remove(); this.info = null}
        let option = cState.open.options[cState.open.selected]
        if (option.completion.info) {
          this.info = this.dom.appendChild(createInfoDialog(option)) as HTMLElement
          this.view.requestMeasure(this.placeInfo)
        }
      }
    }
  }

  updateSelectedOption(selected: number) {
    let set: null | HTMLElement = null
    for (let opt = this.list.firstChild as (HTMLElement | null), i = 0; opt;
         opt = opt.nextSibling as (HTMLElement | null), i++) {
      if (i == selected) {
        if (!opt.hasAttribute("aria-selected")) {
          opt.setAttribute("aria-selected", "true")
          set = opt
        }
      } else {
        if (opt.hasAttribute("aria-selected")) opt.removeAttribute("aria-selected")
      }
    }
    if (set) scrollIntoView(this.list, set)
    return set
  }

  measureInfo() {
    let sel = this.dom.querySelector("[aria-selected]") as HTMLElement | null
    if (!sel) return null
    let rect = this.dom.getBoundingClientRect()
    let top = sel.getBoundingClientRect().top - rect.top
    if (top < 0 || top > this.list.clientHeight - 10) return null
    let left = this.view.textDirection == Direction.RTL
    let spaceLeft = rect.left, spaceRight = innerWidth - rect.right
    if (left && spaceLeft < Math.min(MaxInfoWidth, spaceRight)) left = false
    else if (!left && spaceRight < Math.min(MaxInfoWidth, spaceLeft)) left = true
    return {top, left}
  }

  positionInfo(pos: {top: number, left: boolean} | null) {
    if (this.info && pos) {
      this.info.style.top = pos.top + "px"
      this.info.style.right = pos.left ? "100%" : ""
      this.info.style.left = pos.left ? "" : "100%"
    }
  }
}

// We allocate a new function instance every time the completion
// changes to force redrawing/repositioning of the tooltip
export function completionTooltip(options: readonly Option[], id: string, stateField: StateField<CompletionState>) {
  return (view: EditorView): TooltipView => new CompletionTooltip(view, options, id, stateField)
}

function scrollIntoView(container: HTMLElement, element: HTMLElement) {
  let parent = container.getBoundingClientRect()
  let self = element.getBoundingClientRect()
  if (self.top < parent.top) container.scrollTop -= parent.top - self.top
  else if (self.bottom > parent.bottom) container.scrollTop += self.bottom - parent.bottom
}
