import {Text} from "../../doc/src/text"
import {HeightMap} from "./heightmap"

function visiblePixelRange(dom: HTMLElement, paddingTop: number): {top: number, bottom: number} {
  let rect = dom.getBoundingClientRect()
  let top = Math.max(0, Math.min(innerHeight, rect.top)), bottom = Math.max(0, Math.min(innerHeight, rect.bottom))
  for (let parent = dom.parentNode as any; parent;) { // (Cast to any because TypeScript is useless with Node types)
    if (parent.nodeType == 1) {
      if (parent.scrollHeight > parent.clientHeight) {
        let parentRect = parent.getBoundingClientRect()
        top = Math.min(parentRect.bottom, Math.max(parentRect.top, top))
        bottom = Math.min(parentRect.bottom, Math.max(parentRect.top, bottom))
      }
      parent = parent.parentNode
    } else if (parent.nodeType == 11) { // Shadow root
      parent = parent.host
    } else {
      break
    }
  }
  return {top: top - (rect.top + paddingTop), bottom: bottom - (rect.top + paddingTop)}
}

const VIEWPORT_MARGIN = 1000 // FIXME look into appropriate value of this through benchmarking etc
const MIN_COVER_MARGIN = 10, MAX_COVER_MARGIN = VIEWPORT_MARGIN / 4 // coveredBy requires at least this many extra pixels to be covered

export class ViewportState {
  top: number = 0;
  bottom: number = 0;

  updateFromDOM(dom: HTMLElement, paddingTop: number): number {
    let {top, bottom} = visiblePixelRange(dom, paddingTop)
    let dTop = top - this.top, dBottom = bottom - this.bottom, bias = 0
    if (dTop > 0 && dBottom > 0) bias = Math.max(dTop, dBottom)
    else if (dTop < 0 && dBottom < 0) bias = Math.min(dTop, dBottom)
    this.top = top; this.bottom = bottom
    return bias
  }

  coverEverything() {
    this.top = -2e9
    this.bottom = 2e9
  }

  getViewport(doc: Text, heightMap: HeightMap, bias: number, scrollTo: number): Viewport {
    // This will divide VIEWPORT_MARGIN between the top and the
    // bottom, depending on the bias (the change in viewport position
    // since the last update). It'll hold a number between 0 and 1
    let marginTop = 0.5 - Math.max(-0.5, Math.min(0.5, bias / VIEWPORT_MARGIN / 2))
    let viewport = new Viewport(heightMap.posAt(this.top - marginTop * VIEWPORT_MARGIN, doc, -1),
                                heightMap.posAt(this.bottom + (1 - marginTop) * VIEWPORT_MARGIN, doc, 1))
    // If scrollTo is > -1, make sure the viewport includes that position
    if (scrollTo > -1) {
      if (scrollTo < viewport.from) {
        let top = heightMap.heightAt(scrollTo, doc, -1)
        viewport = new Viewport(heightMap.posAt(top - VIEWPORT_MARGIN / 2, doc, -1),
                                heightMap.posAt(top + (this.bottom - this.top) + VIEWPORT_MARGIN / 2, doc, 1))
      } else if (scrollTo > viewport.to) {
        let bottom = heightMap.heightAt(scrollTo, doc, 1)
        viewport = new Viewport(heightMap.posAt(bottom - (this.bottom - this.top) - VIEWPORT_MARGIN / 2, doc, -1),
                                heightMap.posAt(bottom + VIEWPORT_MARGIN / 2, doc, 1))
      }
    }
    return viewport
  }

  coveredBy(doc: Text, viewport: Viewport, heightMap: HeightMap, bias = 0) {
    let top = heightMap.heightAt(viewport.from, doc, -1), bottom = heightMap.heightAt(viewport.to, doc, 1)
    return (viewport.from == 0 || top <= this.top - Math.max(MIN_COVER_MARGIN, Math.min(-bias, MAX_COVER_MARGIN))) &&
      (viewport.to == doc.length || bottom >= this.bottom + Math.max(MIN_COVER_MARGIN, Math.min(bias, MAX_COVER_MARGIN)))
  }
}

export class Viewport {
  constructor(readonly from: number, readonly to: number) {}
  clip(pos: number): number { return Math.max(this.from, Math.min(this.to, pos)) }
  static empty = new Viewport(0, 0)
}
