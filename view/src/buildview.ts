import {RangeIterator, RangeSet} from "../../rangeset/src/rangeset"
import {DecorationSet, Decoration, RangeDecoration, WidgetDecoration, LineDecoration, BlockWidgetDecoration} from "./decoration"
import {LineView, BlockWidgetView} from "./lineview"
import {WidgetView, TextView} from "./inlineview"
import {Text, TextIterator} from "../../doc/src"

export class ContentBuilder implements RangeIterator<Decoration> {
  content: (LineView | BlockWidgetView)[] = []
  maybeLine = true
  cursor: TextIterator
  text: string = ""
  skip: number
  textOff: number = 0

  constructor(private doc: Text, public pos: number) {
    this.cursor = doc.iter()
    this.skip = pos
  }

  getLine() {
    if (this.maybeLine) {
      let line = new LineView
      this.content.push(line)
      this.maybeLine = false
      return line
    }
    let last = this.content[this.content.length - 1]
    // FIXME remove after testing
    if (!(last instanceof LineView)) throw new Error("Invariant broken: got block widget where line was expected")
    return last
  }

  finish() {
    if (this.maybeLine) this.getLine()
    return this.content
  }

  buildText(length: number, tagName: string | null, clss: string | null, attrs: {[key: string]: string} | null,
            ranges: Decoration[]) {
    while (length > 0) {
      if (this.textOff == this.text.length) {
        let {value, lineBreak, done} = this.cursor.next(this.skip)
        this.skip = 0
        if (done) throw new Error("Ran out of text content when drawing inline views")
        if (lineBreak) {
          if (this.maybeLine) this.getLine()
          length--
          this.maybeLine = true
          continue
        } else {
          this.text = value
          this.textOff = 0
        }
      }
      let take = Math.min(this.text.length - this.textOff, length)
      this.getLine().append(new TextView(this.text.slice(this.textOff, this.textOff + take), tagName, clss, attrs))
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
    if (deco instanceof BlockWidgetDecoration) {
      this.maybeLine = false
      if (pos > this.pos)
        this.content.push(new BlockWidgetView(deco.widget!, pos - this.pos, deco.bias, true))
    } else if (pos > this.pos) {
      let line = this.getLine()
      let widgetView = new WidgetView(pos - this.pos, deco.widget, 0)
      if (line.children.length && line.children[line.children.length - 1].merge(widgetView))
        line.length += widgetView.length
      else
        line.append(widgetView)
    }

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
      this.getLine().append(new WidgetView(0, deco.widget, deco.bias))
    } else if (deco instanceof LineDecoration) {
      if (this.doc.lineAt(this.pos).start == this.pos)
        this.getLine().addLineDeco(deco as LineDecoration)
    } else if (deco instanceof BlockWidgetDecoration) {
      if (deco.bias < 0 ? this.maybeLine : this.doc.lineAt(this.pos).end == this.pos) {
        if (deco.bias > 0 && this.maybeLine) this.getLine()
        this.content.push(new BlockWidgetView(deco.widget!, 0, deco.bias, false))
      }
    }
  }

  ignoreRange(deco: Decoration, to: number): boolean {
    return deco instanceof BlockWidgetDecoration &&
      (!this.maybeLine || this.doc.lineAt(to).end != to)
  }

  ignorePoint(deco: Decoration): boolean { return false }

  static build(text: Text, from: number, to: number, decorations: ReadonlyArray<DecorationSet>): (LineView | BlockWidgetView)[] {
    let builder = new ContentBuilder(text, from)
    RangeSet.iterateSpans(decorations, from, to, builder)
    return builder.finish()
  }
}
