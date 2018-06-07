import browser from "./browser"
import {applyDOMChange} from "./domchange"
import {EditorView} from "./view"
import {ViewDesc} from "./viewdesc"

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

  constructor(public view: EditorView) {
    if (typeof "MutationObserver" != "undefined")
      this.observer = new MutationObserver(mutations => this.applyMutations(mutations))
    if (useCharData)
      this.onCharData = (event: MutationEvent) => {
        this.charDataQueue.push({target: event.target,
                                 type: "characterData",
                                 oldValue: event.prevValue} as MutationRecord)
        if (this.charDataTimeout == null) this.charDataTimeout = setTimeout(() => this.flush(), 20)
      }
  }

  start() {
    if (this.observer)
      this.observer.observe(this.view.contentDOM, observeOptions)
    if (useCharData)
      this.view.contentDOM.addEventListener("DOMCharacterDataModified", this.onCharData)
  }

  stop() {
    if (this.observer) {
      this.flush()
      this.observer.disconnect()
    }
    if (useCharData)
      this.view.contentDOM.removeEventListener("DOMCharacterDataModified", this.onCharData)
  }

  flush() {
    this.applyMutations(this.observer ? this.observer.takeRecords() : [])
  }

  applyMutations(records: MutationRecord[]) {
    if (this.charDataQueue.length) {
      clearTimeout(this.charDataTimeout)
      this.charDataTimeout = null
      records = records.concat(this.charDataQueue)
      this.charDataQueue.length = 0
    }
    if (records.length == 0) return

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

    if (from > -1) applyDOMChange(this.view, from, to)
    else if (this.view.docView.dirty) this.view.setState(this.view.state)
  }

  readMutation(rec: MutationRecord): {from: number, to: number} | null {
    let desc = this.view.docView.nearest(rec.target)
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
}

function findChild(desc: ViewDesc, dom: Node | null): ViewDesc | null {
  for (; dom; dom = dom.parentNode) {
    let curDesc = dom.cmView
    if (curDesc && curDesc.parent == desc) return curDesc
  }
  return null
}
