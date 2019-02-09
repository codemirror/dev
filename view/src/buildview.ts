import {RangeIterator, RangeSet} from "../../rangeset/src/rangeset"
import {DecorationSet, Decoration, ReplaceDecoration, WidgetDecoration, LineDecoration, MarkDecoration} from "./decoration"
import {LineView, BlockWidgetView, BlockType} from "./lineview"
import {WidgetView, TextView} from "./inlineview"
import {Text, TextIterator} from "../../doc/src"

export class ContentBuilder implements RangeIterator<Decoration> {
  content: (LineView | BlockWidgetView)[] = []
  curLine: LineView | null = null
  breakAtStart = 0
  cursor: TextIterator
  text: string = ""
  skip: number
  textOff: number = 0

  constructor(private doc: Text, public pos: number) {
    this.cursor = doc.iter()
    this.skip = pos
  }

  posCovered() {
    if (this.content.length == 0)
      return !this.breakAtStart && this.doc.lineAt(this.pos).start != this.pos
    let last = this.content[this.content.length - 1]
    return !last.breakAfter && !(last instanceof BlockWidgetView && last.type == BlockType.before)
  }

  getLine() {
    if (!this.curLine)
      this.content.push(this.curLine = new LineView)
    return this.curLine
  }

  addWidget(view: BlockWidgetView) {
    this.curLine = null
    this.content.push(view)
  }

  finish() {
    if (!this.posCovered()) this.getLine()
  }

  buildText(length: number, tagName: string | null, clss: string | null, attrs: {[key: string]: string} | null,
            ranges: Decoration[]) {
    while (length > 0) {
      if (this.textOff == this.text.length) {
        let {value, lineBreak, done} = this.cursor.next(this.skip)
        this.skip = 0
        if (done) throw new Error("Ran out of text content when drawing inline views")
        if (lineBreak) {
          if (!this.posCovered()) this.getLine()
          if (this.content.length) this.content[this.content.length - 1].breakAfter = 1
          else this.breakAtStart = 1
          this.curLine = null
          length--
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
    for (let {spec} of active as MarkDecoration[]) {
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

  advanceReplaced(pos: number, deco: ReplaceDecoration) {
    if (deco.block) {
      this.addWidget(new BlockWidgetView(deco.widget, pos - this.pos, true, BlockType.cover))
    } else {
      let line = this.getLine()
      let widgetView = new WidgetView(pos - this.pos, deco.widget, 0)
      if (line.children.length && line.children[line.children.length - 1].merge(widgetView))
        line.length += widgetView.length
      else
        line.append(widgetView)
    }

    // Advance the iterator past the replaced content
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

  point(deco: LineDecoration | WidgetDecoration) {
    if (deco instanceof LineDecoration) {
      if (this.doc.lineAt(this.pos).start == this.pos)
        this.getLine().addLineDeco(deco as LineDecoration)
    } else if (deco.block) {
      if (deco.startSide > 0 && !this.posCovered()) this.getLine()
      this.addWidget(new BlockWidgetView(deco.widget, 0, false,
                                         deco.startSide < 0 ? BlockType.before : BlockType.after))
    } else {
      this.getLine().append(new WidgetView(0, deco.widget, deco.startSide))
    }
  }

  ignoreRange(deco: Decoration): boolean { return false }

  ignorePoint(deco: Decoration): boolean { return false }

  static build(text: Text, from: number, to: number, decorations: ReadonlyArray<DecorationSet>):
    {content: (LineView | BlockWidgetView)[], breakAtStart: number} {
    let builder = new ContentBuilder(text, from)
    RangeSet.iterateSpans(decorations, from, to, builder)
    builder.finish()
    return builder
  }
}
