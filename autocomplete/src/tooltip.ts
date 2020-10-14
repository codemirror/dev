import {EditorView, themeClass, ViewUpdate, Direction} from "@codemirror/next/view"
import {StateField} from "@codemirror/next/state"
import {TooltipView} from "@codemirror/next/tooltip"
import {CompletionState} from "./state"
import {completionConfig} from "./config"
import {Option, applyCompletion} from "./completion"
import {MaxInfoWidth} from "./theme"

function createListBox(options: readonly Option[], id: string, range: {from: number, to: number}) {
  const ul = document.createElement("ul")
  ul.id = id
  ul.setAttribute("role", "listbox")
  ul.setAttribute("aria-expanded", "true")
  for (let i = range.from; i < range.to; i++) {
    let {completion, match} = options[i]
    const li = ul.appendChild(document.createElement("li"))
    li.id = id + "-" + i
    let icon = li.appendChild(document.createElement("div"))
    icon.className = themeClass("completionIcon" + (completion.type ? "." + completion.type : ""))
    icon.setAttribute("aria-hidden", "true")
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
  if (range.from) ul.classList.add(themeClass("completionListIncompleteTop"))
  if (range.to < options.length) ul.classList.add(themeClass("completionListIncompleteBottom"))
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

function rangeAroundSelected(total: number, selected: number, max: number) {
  if (total <= max) return {from: 0, to: total}
  if (selected <= (total >> 1)) {
    let off = Math.floor(selected / max)
    return {from: off * max, to: (off + 1) * max}
  }
  let off = Math.floor((total - selected) / max)
  return {from: total - (off + 1) * max, to: total - off * max}
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
  range: {from: number, to: number}

  constructor(readonly view: EditorView,
              readonly stateField: StateField<CompletionState>) {
    let cState = view.state.field(stateField)
    let {options, selected} = cState.open!
    let config = view.state.facet(completionConfig)
    this.range = rangeAroundSelected(options.length, selected, config.maxRenderedOptions)

    this.dom = document.createElement("div")
    this.dom.addEventListener("mousedown", (e: MouseEvent) => {
      let index = this.range.from, dom = e.target as HTMLElement | null
      while (dom && dom != this.list && dom.parentNode != this.list) dom = dom.parentNode as (HTMLElement | null)
      for (;;) { dom = dom!.previousSibling as (HTMLElement | null); if (!dom) break; index++ }
      if (index >= 0 && index < options.length) applyCompletion(view, options[index])
      e.preventDefault()
    })
    this.list = this.dom.appendChild(createListBox(options, cState.id, this.range))
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
    let cState = this.view.state.field(this.stateField), open = cState.open!
    if (open.selected < this.range.from || open.selected >= this.range.to) {
      this.range = rangeAroundSelected(open.options.length, open.selected,
                                       this.view.state.facet(completionConfig).maxRenderedOptions)
      this.list.remove()
      this.list = this.dom.appendChild(createListBox(open.options, cState.id, this.range))
      this.list.addEventListener("scroll", () => {
        if (this.info) this.view.requestMeasure(this.placeInfo)
      })
    }

    if (this.updateSelectedOption(open.selected)) {
      if (this.info) {this.info.remove(); this.info = null}
      let option = open.options[open.selected]
      if (option.completion.info) {
        this.info = this.dom.appendChild(createInfoDialog(option)) as HTMLElement
        this.view.requestMeasure(this.placeInfo)
      }
    }
  }

  updateSelectedOption(selected: number) {
    let set: null | HTMLElement = null
    for (let opt = this.list.firstChild as (HTMLElement | null), i = this.range.from; opt;
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
      this.info.classList.toggle("cm-tooltip-completionInfo-left", pos.left)
      this.info.classList.toggle("cm-tooltip-completionInfo-right", !pos.left)
    }
  }
}

// We allocate a new function instance every time the completion
// changes to force redrawing/repositioning of the tooltip
export function completionTooltip(stateField: StateField<CompletionState>) {
  return (view: EditorView): TooltipView => new CompletionTooltip(view, stateField)
}

function scrollIntoView(container: HTMLElement, element: HTMLElement) {
  let parent = container.getBoundingClientRect()
  let self = element.getBoundingClientRect()
  if (self.top < parent.top) container.scrollTop -= parent.top - self.top
  else if (self.bottom > parent.bottom) container.scrollTop += self.bottom - parent.bottom
}
