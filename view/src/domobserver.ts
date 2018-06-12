import browser from "./browser"
import {DocViewDesc, ViewDesc} from "./viewdesc"
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

export class DOMObserver {
  observer: MutationObserver | null = null;
  onCharData: any;
  charDataQueue: MutationRecord[] = [];
  charDataTimeout: any = null;
  active: boolean = false;
  dom: HTMLElement;

  constructor(private docView: DocViewDesc,
              private onDOMChange: (from: number, to: number) => void,
              private onSelectionChange: () => void) {
    this.dom = docView.dom as HTMLElement
    if (typeof MutationObserver != "undefined")
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
    if (this.observer)
      this.observer.observe(this.dom, observeOptions)
    if (useCharData)
      this.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
    this.active = true
  }

  stop() {
    if (!this.active) return
    this.active = false
    if (this.observer) {
      this.flush()
      this.observer.disconnect()
    }
    if (useCharData)
      this.dom.removeEventListener("DOMCharacterDataModified", this.onCharData)
  }

  flush(): boolean {
    return this.applyMutations(this.observer ? this.observer.takeRecords() : [])
  }

  applyMutations(records: MutationRecord[]): boolean {
    if (this.charDataQueue.length) {
      clearTimeout(this.charDataTimeout)
      this.charDataTimeout = null
      records = records.concat(this.charDataQueue)
      this.charDataQueue.length = 0
    }
    if (records.length == 0) return false

    let from = -1, to = -1
    for (let record of records) {
      let range = this.readMutation(record)
      if (!range) continue
      if (from == -1) {
        ;({from, to} = range)
      } else {
        from = Math.min(range.from, from)
        to = Math.max(range.to, to)
      }
    }

    let apply = from > -1 && this.active
    if (apply) this.onDOMChange(from, to)
    if (this.docView.dirty) this.docView.sync()
    return apply
  }

  readMutation(rec: MutationRecord): {from: number, to: number} | null {
    let desc = this.docView.nearest(rec.target)
    if (!desc) return null // FIXME query domView for ignorable mutations
    desc.markDirty()

    if (rec.type == "childList") {
      let childBefore = rec.previousSibling && findChild(desc, rec.previousSibling)
      let childAfter = rec.nextSibling && findChild(desc, rec.nextSibling)
      return {from: childBefore ? desc.posAfter(childBefore) : desc.posAtStart,
              to: childAfter ? desc.posBefore(childAfter) : desc.posAtEnd}
    } else { // "characterData"
      // FIXME insert ProseMirror's typeOver hack
      return {from: desc.posAtStart, to: desc.posAtEnd}
    }
  }

  readSelection() {
    let root = getRoot(this.dom)
    if (!this.active || root.activeElement != this.dom || !hasSelection(this.dom)) return
    if (!this.flush()) this.onSelectionChange()
  }

  destroy() {
    this.stop()
    this.dom.ownerDocument.removeEventListener("selectionchange", this.readSelection)
  }
}

function findChild(desc: ViewDesc, dom: Node | null): ViewDesc | null {
  for (; dom; dom = dom.parentNode) {
    let curDesc = dom.cmView
    if (curDesc && curDesc.parent == desc) return curDesc
  }
  return null
}
