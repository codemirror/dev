import {SpanIterator, RangeSet} from "@codemirror/next/rangeset"
import {DecorationSet, Decoration, PointDecoration, LineDecoration, MarkDecoration, BlockType, WidgetType} from "./decoration"
import {BlockView, LineView, BlockWidgetView} from "./blockview"
import {InlineView, WidgetView, TextView, MarkView} from "./inlineview"
import {Text, TextIterator} from "@codemirror/next/text"

export class ContentBuilder implements SpanIterator<Decoration> {
  content: BlockView[] = []
  curLine: LineView | null = null
  breakAtStart = 0
  openStart = -1
  openEnd = -1
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
      return !this.breakAtStart && this.doc.lineAt(this.pos).from != this.pos
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

  wrapMarks(view: InlineView, active: readonly MarkDecoration[]) {
    for (let i = active.length - 1; i >= 0; i--)
      view = new MarkView(active[i], [view], view.length)
    return view
  }

  buildText(length: number, active: readonly MarkDecoration[], openStart: number) {
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
      this.getLine().append(this.wrapMarks(new TextView(this.text.slice(this.textOff, this.textOff + take)), active), openStart)
      length -= take
      this.textOff += take
    }
  }

  span(from: number, to: number, active: MarkDecoration[], openStart: number) {
    this.buildText(to - from, active, openStart)
    this.pos = to
    if (this.openStart < 0) this.openStart = openStart
  }

  point(from: number, to: number, deco: Decoration, active: MarkDecoration[], openStart: number) {
    let len = to - from
    if (deco instanceof PointDecoration) {
      if (deco.block) {
        let {type} = deco
        if (type == BlockType.WidgetAfter && !this.posCovered()) this.getLine()
        this.addWidget(new BlockWidgetView(deco.widget || new NullWidget("div"), len, type))
      } else {
        let widget = this.wrapMarks(WidgetView.create(deco.widget || new NullWidget("span"), len, deco.startSide), active)
        this.getLine().append(widget, openStart)
      }
    } else if (this.doc.lineAt(this.pos).from == this.pos) { // Line decoration
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
    if (this.openStart < 0) this.openStart = openStart
  }

  static build(text: Text, from: number, to: number, decorations: readonly DecorationSet[]):
    {content: BlockView[], breakAtStart: number, openStart: number, openEnd: number} {
    let builder = new ContentBuilder(text, from, to)
    builder.openEnd = RangeSet.spans(decorations, from, to, builder)
    if (builder.openStart < 0) builder.openStart = builder.openEnd
    builder.finish()
    return builder
  }
}

class NullWidget extends WidgetType<string> {
  toDOM() { return document.createElement(this.value) }
  updateDOM(elt: HTMLElement) { return elt.nodeName.toLowerCase() == this.value }
}
