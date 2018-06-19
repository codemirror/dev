import {Text} from "../../doc/src/text"
import {HeightMap} from "./heightmap"

function visiblePixelRange(dom: HTMLElement): {top: number, bottom: number} {
  let rect = dom.getBoundingClientRect()
  let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
  for (let parent = dom.parentNode as any; parent;) { // (Cast to any because TypeScript is useless with Node types)
    if (parent.nodeType == 1) {
      if (parent.scrollHeight > parent.clientHeight) {
        let parentRect = parent.getBoundingClientRect()
        top = Math.max(top, parentRect.top)
        bottom = Math.min(bottom, parentRect.bottom)
      }
      parent = parent.parentNode
    } else if (parent.nodeType == 11) { // Shadow root
      parent = parent.host
    } else {
      break
    }
  }
  return {top: top - rect.top, bottom: bottom - rect.top}
}

const VIEWPORT_MARGIN = 500 // FIXME look into appropriate value of this through benchmarking etc
const COVER_MARGIN = 10 // coveredBy requires at least this many extra pixels to be covered

export class ViewportState {
  top: number = 0;
  bottom: number = 0;

  updateFromDOM(dom: HTMLElement) {
    ;({top: this.top, bottom: this.bottom} = visiblePixelRange(dom))
  }

  getViewport(doc: Text, heightMap: HeightMap): Viewport {
    return new Viewport(heightMap.startAtHeight(this.top - VIEWPORT_MARGIN, doc),
                        heightMap.endAtHeight(this.bottom + VIEWPORT_MARGIN, doc))
  }

  coveredBy(doc: Text, viewport: Viewport, heightMap: HeightMap) {
    let top = heightMap.heightAt(viewport.from, -1), bottom = heightMap.heightAt(viewport.to, 1)
    console.log("cmputed", top, bottom, "vs", this.top, this.bottom)
    return (top <= this.top - COVER_MARGIN || viewport.from == 0) &&
      (bottom >= this.bottom + COVER_MARGIN || viewport.to == doc.length)
  }
}

export class Viewport {
  constructor(readonly from: number, readonly to: number) {}
  eq(other: Viewport): boolean { return this.from == other.from && this.to == other.to }
  clip(pos: number): number { return Math.max(this.from, Math.min(this.to, pos)) }
}
