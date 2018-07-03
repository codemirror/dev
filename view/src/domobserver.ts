import browser from "./browser"
import {ContentView} from "./contentview"
import {DocView} from "./docview"
import {hasSelection, getRoot} from "./dom"

const observeOptions = {
  childList: true,
  characterData: true,
  subtree: true,
  characterDataOldValue: true
}

// IE11 has very broken mutation observers, so we also listen to
// DOMCharacterDataModified there
const useCharData = browser.ie && browser.ie_version <= 11

const thresholds: number[] = []
for (let i = 0; i <= 100; i += 2) thresholds.push(i / 100)

export class DOMObserver {
  observer: MutationObserver
  onCharData: any
  charDataQueue: MutationRecord[] = []
  charDataTimeout: any = null
  active: boolean = false
  dom: HTMLElement
  intersection: IntersectionObserver

  constructor(private docView: DocView,
              private onDOMChange: (from: number, to: number, typeOver: boolean) => void,
              private onSelectionChange: () => void,
              private onIntersect: () => void) {
    this.dom = docView.dom
    this.observer = new MutationObserver(mutations => this.applyMutations(mutations))
    if (useCharData)
      this.onCharData = (event: MutationEvent) => {
        this.charDataQueue.push({target: event.target,
                                 type: "characterData",
                                 oldValue: event.prevValue} as MutationRecord)
        if (this.charDataTimeout == null) this.charDataTimeout = setTimeout(() => this.flush(), 20)
      }
    this.readSelection = this.readSelection.bind(this)
    this.listenForSelectionChanges()
    // FIXME need a fallback for IE11
    this.intersection = new IntersectionObserver(entries => {
      let intersects = false, full = false
      for (let {intersectionRatio} of entries) if (intersectionRatio > 0) {
        intersects = true
        if (intersectionRatio == 1) full = true
      }
      if (intersects) this.onIntersect()
      // Sometimes, during quick scrolling, it seems even though a
      // redraw happens, intersection stays at 1 and no new entries
      // are fired—this makes sure an extra check happens in that case
      if (full) setTimeout(() => this.onIntersect(), 100)
    }, {threshold: thresholds})
    this.start()
  }

  listenForSelectionChanges() {
    let listening = false
    this.dom.addEventListener("focus", () => {
      if (listening) return
      this.dom.ownerDocument.addEventListener("selectionchange", this.readSelection)
      listening = true
      if (hasSelection(this.dom)) this.readSelection()
    })
    this.dom.addEventListener("blur", () => {
      if (!listening) return
      this.dom.ownerDocument.removeEventListener("selectionchange", this.readSelection)
      listening = false
    })
  }

  withoutListening(f: () => void) {
    try {
      this.stop()
      f()
    } finally {
      this.start()
    }
  }

  start() {
    if (this.active) return
    this.observer.observe(this.dom, observeOptions)
    if (useCharData)
      this.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
    this.intersection.takeRecords() // Dump any existing records
    this.active = true
  }

  stop() {
    if (!this.active) return
    this.active = false
    // FIXME we're throwing away DOM events when flushing like this,
    // to avoid recursively calling `setState` when setting a new
    // state, but that could in some circumstances drop information
    this.flush()
    this.observer.disconnect()
    if (useCharData)
      this.dom.removeEventListener("DOMCharacterDataModified", this.onCharData)
  }

  flush(): boolean {
    return this.applyMutations(this.observer.takeRecords())
  }

  applyMutations(records: MutationRecord[]): boolean {
    if (this.charDataQueue.length) {
      clearTimeout(this.charDataTimeout)
      this.charDataTimeout = null
      records = records.concat(this.charDataQueue)
      this.charDataQueue.length = 0
    }
    if (records.length == 0) return false

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

    let apply = from > -1 && this.active
    if (apply) this.onDOMChange(from, to, typeOver)
    if (this.docView.dirty) this.docView.sync()
    return apply
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

  readSelection() {
    let root = getRoot(this.dom)
    if (!this.active || root.activeElement != this.dom || !hasSelection(this.dom)) return
    if (!this.flush()) this.onSelectionChange()
  }

  observeIntersection(dom: HTMLElement[]) {
    this.intersection.disconnect()
    for (let elt of dom) this.intersection.observe(elt)
  }

  destroy() {
    this.stop()
    this.dom.ownerDocument.removeEventListener("selectionchange", this.readSelection)
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
