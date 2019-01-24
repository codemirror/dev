import {RangeIterator, RangeSet} from "../../rangeset/src/rangeset"
import {DecorationSet, Decoration, RangeDecoration, WidgetDecoration, LineDecoration, BlockWidgetDecoration} from "./decoration"
import {LineView} from "./lineview"
import {WidgetView, TextView} from "./inlineview"
import {Text, TextIterator} from "../../doc/src"

export class ContentBuilder implements RangeIterator<Decoration> {
  lines: LineView[]
  cursor: TextIterator
  text: string = ""
  skip: number
  textOff: number = 0
  lineStart: boolean

  constructor(private doc: Text, public pos: number) {
    this.cursor = doc.iter()
    this.skip = pos
    this.lines = [new LineView]
    this.lineStart = doc.lineAt(pos).start == pos
  }

  buildText(length: number, tagName: string | null, clss: string | null, attrs: {[key: string]: string} | null,
            ranges: Decoration[]) {
    while (length > 0) {
      if (this.textOff == this.text.length) {
        let {value, lineBreak, done} = this.cursor.next(this.skip)
        this.skip = 0
        if (done) throw new Error("Ran out of text content when drawing inline views")
        if (lineBreak) {
          this.lines.push(new LineView)
          this.lineStart = true
          length--
          continue
        } else {
          this.text = value
          this.textOff = 0
        }
      }
      let take = Math.min(this.text.length - this.textOff, length)
      this.curLine.append(new TextView(this.text.slice(this.textOff, this.textOff + take), tagName, clss, attrs))
      this.lineStart = false
      length -= take
      this.textOff += take
    }
  }

  advance(pos: number, active: Decoration[]) {
    if (pos <= this.pos) return

    let tagName = null, clss = null
    let attrs: {[key: string]: string} | null = null
    for (let {spec} of active as RangeDecoration[]) {
      if (spec.tagName) tagName = spec.tagName
      if (spec.class) clss = clss ? clss + " " + spec.class : spec.class
      if (spec.attributes) for (let name in spec.attributes) {
        let value = spec.attributes[name]
        if (value == null) continue
        if (name == "class") {
          clss = clss ? clss + " " + value : value
        } else {
          if (!attrs) attrs = {}
          if (name == "style" && attrs.style) value = attrs.style + ";" + value
          attrs[name] = value
        }
      }
    }

    this.buildText(pos - this.pos, tagName, clss, attrs, active)
    this.pos = pos
  }

  advanceCollapsed(pos: number, deco: Decoration) {
    if (pos <= this.pos) return

    let line = this.curLine
    let widgetView = new WidgetView(pos - this.pos, deco.widget, 0)
    if (line.children.length && line.children[line.children.length - 1].merge(widgetView))
      line.length += widgetView.length
    else
      line.append(widgetView)
    if (widgetView.length) this.lineStart = false

    // Advance the iterator past the collapsed content
    let length = pos - this.pos
    if (this.textOff + length <= this.text.length) {
      this.textOff += length
    } else {
      this.skip += length - (this.text.length - this.textOff)
      this.text = ""
      this.textOff = 0
    }

    this.pos = pos
  }

  point(deco: Decoration) {
    if (deco instanceof WidgetDecoration) {
      this.curLine.append(new WidgetView(0, deco.widget, deco.bias))
    } else if (deco instanceof LineDecoration) {
      if (this.lineStart) this.curLine.addLineDeco(deco as LineDecoration)
    } else if (deco instanceof BlockWidgetDecoration) {
      // FIXME
      if (deco.bias < 0 && this.lineStart)
      {} // this.lines.splice(this.lines.length - 1, 0, new BlockWidgetView(deco.widget))
      else if (deco.bias > 0 && this.doc.lineAt(this.pos).end == this.pos)
      {} // this.lines.push(new BlockWidgetView(deco.widget))
    }
  }

  get curLine() { return this.lines[this.lines.length - 1] }

  ignoreRange(deco: RangeDecoration): boolean { return false }
  ignorePoint(deco: Decoration): boolean { return false }

  static build(text: Text, from: number, to: number, decorations: ReadonlyArray<DecorationSet>): LineView[] {
    let builder = new ContentBuilder(text, from)
    RangeSet.iterateSpans(decorations, from, to, builder)
    return builder.lines
  }
}
