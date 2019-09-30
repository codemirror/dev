import {RangeIterator, RangeSet} from "../../rangeset"
import {DecorationSet, Decoration, PointDecoration, LineDecoration, MarkDecoration, BlockType, WidgetType} from "./decoration"
import {BlockView, LineView, BlockWidgetView} from "./blockview"
import {WidgetView, TextView} from "./inlineview"
import {Text, TextIterator} from "../../text"

export const enum Open { Start = 1, End = 2 }

export class ContentBuilder implements RangeIterator<Decoration> {
  content: BlockView[] = []
  curLine: LineView | null = null
  breakAtStart = 0
  cursor: TextIterator
  text: string = ""
  skip: number
  textOff: number = 0

  constructor(private doc: Text, public pos: number, public end: number) {
    this.cursor = doc.iter()
    this.skip = pos
  }

  posCovered() {
    if (this.content.length == 0)
      return !this.breakAtStart && this.doc.lineAt(this.pos).start != this.pos
    let last = this.content[this.content.length - 1]
    return !last.breakAfter && !(last instanceof BlockWidgetView && last.type == BlockType.WidgetBefore)
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

  span(from: number, to: number, active: Decoration[]) {
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

    this.buildText(to - from, tagName, clss, attrs, active)
    this.pos = to
  }

  point(from: number, to: number, deco: Decoration, openStart: boolean, openEnd: boolean) {
    let open = (openStart ? Open.Start : 0) | (openEnd ? Open.End : 0)
    let len = to - from
    if (deco instanceof PointDecoration) {
      if (deco.block) {
        let {type} = deco
        if (type == BlockType.WidgetAfter && !this.posCovered()) this.getLine()
        this.addWidget(new BlockWidgetView(deco.widget || new NullWidget("div"), len, type, open))
      } else {
        this.getLine().append(WidgetView.create(deco.widget || new NullWidget("span"), len, deco.startSide, open))
      }
    } else if (this.doc.lineAt(this.pos).start == this.pos) { // Line decoration
      this.getLine().addLineDeco(deco as LineDecoration)
    }

    if (len) {
      // Advance the iterator past the replaced content
      if (this.textOff + len <= this.text.length) {
        this.textOff += len
      } else {
        this.skip += len - (this.text.length - this.textOff)
        this.text = ""
        this.textOff = 0
      }
      this.pos = to
    }
  }

  ignore(): boolean { return false }

  static build(text: Text, from: number, to: number, decorations: ReadonlyArray<DecorationSet>):
    {content: BlockView[], breakAtStart: number} {
    let builder = new ContentBuilder(text, from, to)
    RangeSet.iterateSpans(decorations, from, to, builder)
    builder.finish()
    return builder
  }
}

class NullWidget extends WidgetType<string> {
  toDOM() { return document.createElement(this.value) }
  updateDOM(elt: HTMLElement) { return elt.nodeName.toLowerCase() == this.value }
}
