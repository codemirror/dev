import browser from "./browser"
import {ContentView} from "./contentview"
import {DocView} from "./docview"
import {hasSelection, DOMSelection, getRoot} from "./dom"

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

  onSelectionChange: any
  onCharData: any

  charDataQueue: MutationRecord[] = []
  charDataTimeout: any = null
  startingCompositionTimeout: any = null

  scrollTargets: HTMLElement[] = []
  intersection: IntersectionObserver | null = null
  intersecting: boolean = true

  constructor(private docView: DocView,
              private onChange: (from: number, to: number, typeOver: boolean) => boolean,
              private onScrollChanged: () => void) {
    this.dom = docView.dom
    this.observer = new MutationObserver(mutations => this.flush(mutations))
    if (useCharData)
      this.onCharData = (event: MutationEvent) => {
        this.charDataQueue.push({target: event.target,
                                 type: "characterData",
                                 oldValue: event.prevValue} as MutationRecord)
        if (this.charDataTimeout == null) this.charDataTimeout = setTimeout(() => this.flush(), 20)
      }
    this.onSelectionChange = () => {
      if (getRoot(this.dom).activeElement == this.dom) this.flush()
    }
    this.start()

    this.onScroll = this.onScroll.bind(this)
    window.addEventListener("scroll", this.onScroll)
    if (typeof IntersectionObserver == "function") {
      this.intersection = new IntersectionObserver(entries => {
        if (entries[entries.length - 1].intersectionRatio > 0 != this.intersecting) {
          this.intersecting = !this.intersecting
          this.onScroll()
        }
      }, {})
      this.intersection.observe(this.dom)
    }
    this.listenForScroll()
  }

  onScroll() {
    if (this.intersecting) {
      this.flush()
      this.onScrollChanged()
    }
  }

  listenForScroll() {
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
    // FIXME is this shadow-root safe?
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

  takeCharRecords(): MutationRecord[] {
    let result = this.charDataQueue
    if (result.length) {
      this.charDataQueue = []
      clearTimeout(this.charDataTimeout)
      this.charDataTimeout = null
    }
    return result
  }

  clearSelection() {
    this.ignoreSelection.set(getRoot(this.dom).getSelection()!)
  }

  // Throw away any pending changes
  clear() {
    this.observer.takeRecords()
    this.takeCharRecords()
    this.clearSelection()
  }

  // Apply pending changes, if any
  flush(records: MutationRecord[] = this.observer.takeRecords()) {
    if (this.startingCompositionTimeout != null) {
      this.clearComposition()
      this.docView.createCompositionNode()
    }
    if (this.charDataQueue.length)
      records = records.concat(this.takeCharRecords())
    let newSel = !this.ignoreSelection.eq(getRoot(this.dom).getSelection()!) &&
      hasSelection(this.dom)
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

    let apply = from > -1 || newSel
    if (!apply || !this.onChange(from, to, typeOver)) {
      if (this.docView.dirty) this.ignore(() => this.docView.sync())
      this.docView.updateSelection()
    }
    this.clearSelection()
  }

  readMutation(rec: MutationRecord): {from: number, to: number, typeOver: boolean} | null {
    let cView = this.docView.nearest(rec.target)
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

  startComposition() {
    if (this.startingCompositionTimeout == null)
      this.startingCompositionTimeout = setTimeout(() => {
        this.docView.createCompositionNode()
        this.clearComposition()
      }, 20)
  }

  clearComposition() {
    if (this.startingCompositionTimeout != null) {
      clearTimeout(this.startingCompositionTimeout)
      this.startingCompositionTimeout = null
    }
  }

  destroy() {
    this.stop()
    if (this.intersection) this.intersection.disconnect()
    for (let dom of this.scrollTargets) dom.removeEventListener("scroll", this.onScroll)
    window.removeEventListener("scroll", this.onScroll)
  }
}

function findChild(cView: ContentView, dom: Node | null, dir: number): ContentView | null {
  while (dom) {
    let curView = dom.cmView
    if (curView && curView.parent == cView) return curView
    let parent = dom.parentNode
    dom = parent != cView.dom ? parent : dir > 0 ? dom.nextSibling : dom.previousSibling
  }
  return null
}
