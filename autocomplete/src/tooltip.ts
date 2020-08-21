import {EditorView, themeClass, ViewUpdate} from "@codemirror/next/view"
import {StateField} from "@codemirror/next/state"
import {TooltipView} from "@codemirror/next/tooltip"
import {CompletionState} from "./state"
import {Option, applyCompletion} from "./completion"

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

// We allocate a new function instance every time the completion
// changes to force redrawing/repositioning of the tooltip
export function completionTooltip(options: readonly Option[], id: string, stateField: StateField<CompletionState>) {
  return (view: EditorView): TooltipView => {
    let wrap = document.createElement("div")
    let list = wrap.appendChild(createListBox(options, id))
    list.addEventListener("click", (e: MouseEvent) => {
      let index = 0, dom = e.target as HTMLElement | null
      for (;;) { dom = dom!.previousSibling as (HTMLElement | null); if (!dom) break; index++ }
      if (index < options.length) applyCompletion(view, options[index])
    })
    function updateSel(view: EditorView) {
      let cState = view.state.field(stateField)
      if (cState.open) updateSelectedOption(list, cState.open.selected)
    }
    return {
      dom: wrap,
      mount: updateSel,
      update(update: ViewUpdate) {
        if (update.state.field(stateField) != update.prevState.field(stateField))
          updateSel(update.view)
      }
    }
  }
}

function updateSelectedOption(list: HTMLElement, selected: number) {
  let set: null | HTMLElement = null
  for (let opt = list.firstChild as (HTMLElement | null), i = 0; opt;
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
  if (set) scrollIntoView(list, set)
}

function scrollIntoView(container: HTMLElement, element: HTMLElement) {
  let parent = container.getBoundingClientRect()
  let self = element.getBoundingClientRect()
  if (self.top < parent.top) container.scrollTop -= parent.top - self.top
  else if (self.bottom > parent.bottom) container.scrollTop += self.bottom - parent.bottom
}
