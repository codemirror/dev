import browser from "./browser"
import {ContentView, Dirty} from "./contentview"
import {EditorView} from "./editorview"
import {hasSelection, getSelection, DOMSelection, isEquivalentPosition} from "./dom"

const observeOptions = {
  childList: true,
  characterData: true,
  subtree: true,
  characterDataOldValue: true
}

// IE11 has very broken mutation observers, so we also listen to
// DOMCharacterDataModified there
const useCharData = browser.ie && browser.ie_version <= 11

export class DOMObserver {
  dom: HTMLElement

  observer: MutationObserver
  active: boolean = false
  ignoreSelection: DOMSelection = new DOMSelection

  delayedFlush = -1
  queue: MutationRecord[] = []

  onSelectionChange: any
  onCharData: any

  scrollTargets: HTMLElement[] = []
  intersection: IntersectionObserver | null = null
  intersecting: boolean = false

  // Timeout for scheduling check of the parents that need scroll handlers
  parentCheck = -1

  constructor(private view: EditorView,
              private onChange: (from: number, to: number, typeOver: boolean) => void,
              private onScrollChanged: (event: Event) => void) {
    this.dom = view.contentDOM
    this.observer = new MutationObserver(mutations => {
      for (let mut of mutations) this.queue.push(mut)
      // IE11 will sometimes (on typing over a selection or
      // backspacing out a single character text node) call the
      // observer callback before actually updating the DOM
      if (browser.ie && browser.ie_version <= 11 &&
          mutations.some(m => m.type == "childList" && m.removedNodes.length ||
                         m.type == "characterData" && m.oldValue!.length > m.target.nodeValue!.length))
        this.flushSoon()
      else
        this.flush()
    })

    if (useCharData)
      this.onCharData = (event: MutationEvent) => {
        this.queue.push({target: event.target,
                         type: "characterData",
                         oldValue: event.prevValue} as MutationRecord)
        this.flushSoon()
      }

    this.onSelectionChange = (event: Event) => {
      if (this.view.root.activeElement != this.dom) return
      let sel = getSelection(this.view.root)
      let context = sel.anchorNode && this.view.docView.nearest(sel.anchorNode)
      if (context && context.ignoreEvent(event)) return

      // Deletions on IE11 fire their events in the wrong order, giving
      // us a selection change event before the DOM changes are
      // reported.
      // (Selection.isCollapsed isn't reliable on IE)
      if (browser.ie && browser.ie_version <= 11 && !this.view.state.selection.primary.empty &&
          sel.focusNode && isEquivalentPosition(sel.focusNode, sel.focusOffset, sel.anchorNode, sel.anchorOffset))
        this.flushSoon()
      else
        this.flush()
    }

    this.start()

    this.onScroll = this.onScroll.bind(this)
    window.addEventListener("scroll", this.onScroll)
    if (typeof IntersectionObserver == "function") {
      this.intersection = new IntersectionObserver(entries => {
        if (this.parentCheck < 0) this.parentCheck = setTimeout(this.listenForScroll.bind(this), 1000)
        if (entries[entries.length - 1].intersectionRatio > 0 != this.intersecting) {
          this.intersecting = !this.intersecting
          this.onScrollChanged(document.createEvent("Event"))
        }
      }, {})
      this.intersection.observe(this.dom)
    }
    this.listenForScroll()
  }

  onScroll(e: Event) {
    if (this.intersecting) {
      this.flush()
      this.onScrollChanged(e)
    }
  }

  listenForScroll() {
    this.parentCheck = -1
    let i = 0, changed: HTMLElement[] | null = null
    for (let dom = this.dom as any; dom;) {
      if (dom.nodeType == 1) {
        if (!changed && i < this.scrollTargets.length && this.scrollTargets[i] == dom) i++
        else if (!changed) changed = this.scrollTargets.slice(0, i)
        if (changed) changed.push(dom)
        dom = dom.parentNode
      } else if (dom.nodeType == 11) { // Shadow root
        dom = dom.host
      } else {
        break
      }
    }
    if (i < this.scrollTargets.length && !changed) changed = this.scrollTargets.slice(0, i)
    if (changed) {
      for (let dom of this.scrollTargets) dom.removeEventListener("scroll", this.onScroll)
      for (let dom of this.scrollTargets = changed) dom.addEventListener("scroll", this.onScroll)
    }
  }

  ignore<T>(f: () => T): T {
    if (!this.active) return f()
    try {
      this.stop()
      return f()
    } finally {
      this.start()
      this.clear()
    }
  }

  start() {
    if (this.active) return
    this.observer.observe(this.dom, observeOptions)
    this.dom.ownerDocument!.addEventListener("selectionchange", this.onSelectionChange)
    if (useCharData)
      this.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
    this.active = true
  }

  stop() {
    if (!this.active) return
    this.active = false
    this.observer.disconnect()
    this.dom.ownerDocument!.removeEventListener("selectionchange", this.onSelectionChange)
    if (useCharData)
      this.dom.removeEventListener("DOMCharacterDataModified", this.onCharData)
  }

  clearSelection() {
    this.ignoreSelection.set(getSelection(this.view.root))
  }

  // Throw away any pending changes
  clear() {
    this.observer.takeRecords()
    this.queue.length = 0
    this.clearSelection()
  }

  flushSoon() {
    if (this.delayedFlush < 0)
      this.delayedFlush = window.setTimeout(() => { this.delayedFlush = -1; this.flush() }, 20)
  }

  forceFlush() {
    if (this.delayedFlush >= 0) {
      window.clearTimeout(this.delayedFlush)
      this.delayedFlush = -1
      this.flush()
    }
  }

  // Apply pending changes, if any
  flush() {
    if (this.delayedFlush >= 0) return

    let records = this.queue
    for (let mut of this.observer.takeRecords()) records.push(mut)
    if (records.length) this.queue = []

    let selection = getSelection(this.view.root)
    let newSel = !this.ignoreSelection.eq(selection) && hasSelection(this.dom, selection)
    if (records.length == 0 && !newSel) return

    let from = -1, to = -1, typeOver = false
    for (let record of records) {
      let range = this.readMutation(record)
      if (!range) continue
      if (range.typeOver) typeOver = true
      if (from == -1) {
        ;({from, to} = range)
      } else {
        from = Math.min(range.from, from)
        to = Math.max(range.to, to)
      }
    }

    let startState = this.view.state
    if (from > -1 || newSel) this.onChange(from, to, typeOver)
    if (this.view.state == startState) { // The view wasn't updated
      if (this.view.docView.dirty) {
        this.ignore(() => this.view.docView.sync())
        this.view.docView.dirty = Dirty.Not
      }
      this.view.docView.updateSelection()
    }
    this.clearSelection()
  }

  readMutation(rec: MutationRecord): {from: number, to: number, typeOver: boolean} | null {
    let cView = this.view.docView.nearest(rec.target)
    if (!cView || cView.ignoreMutation(rec)) return null
    cView.markDirty()

    if (rec.type == "childList") {
      let childBefore = findChild(cView, rec.previousSibling || rec.target.previousSibling, -1)
      let childAfter = findChild(cView, rec.nextSibling || rec.target.nextSibling, 1)
      return {from: childBefore ? cView.posAfter(childBefore) : cView.posAtStart,
              to: childAfter ? cView.posBefore(childAfter) : cView.posAtEnd, typeOver: false}
    } else { // "characterData"
      return {from: cView.posAtStart, to: cView.posAtEnd, typeOver: rec.target.nodeValue == rec.oldValue}
    }
  }

  destroy() {
    this.stop()
    if (this.intersection) this.intersection.disconnect()
    for (let dom of this.scrollTargets) dom.removeEventListener("scroll", this.onScroll)
    window.removeEventListener("scroll", this.onScroll)
    clearTimeout(this.parentCheck)
  }
}

function findChild(cView: ContentView, dom: Node | null, dir: number): ContentView | null {
  while (dom) {
    let curView = ContentView.get(dom)
    if (curView && curView.parent == cView) return curView
    let parent = dom.parentNode
    dom = parent != cView.dom ? parent : dir > 0 ? dom.nextSibling : dom.previousSibling
  }
  return null
}
