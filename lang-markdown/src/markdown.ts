import {Tree, NodeType, NodeGroup} from "lezer-tree"

class BlockContext {
  readonly children: Tree[] = []
  readonly positions: number[] = []

  constructor(readonly type: number,
              readonly indent: number,
              readonly from: number,
              readonly contentStart: number,
              readonly markup: number) {}

  toTree(end: number) {
    return new Tree(Group.types[this.type], this.children, this.positions, end - this.from)
  }
}

export enum Type {
  Document = 1,

  CodeBlock,
  FencedCode,
  Blockquote,
  HorizontalRule,
  BulletList,
  OrderedList,
  ListItem,
  ATXHeading,
  SetextHeading,
  HTMLBlock,
  LinkReference,
  Paragraph,
  Comment,

  // Inline
  Escape,
  Entity,
  HardBreak,
  Emphasis,
  StrongEmphasis,
  Link,
  Image,
  InlineCode,
  HTMLTag,
  URL,

  // Smaller tokens
  HeaderMark,
  QuoteMark,
  ListMark,
  LinkMark,
  EmphasisMark,
  CodeMark,
  CodeInfo,
  LinkTitle,
  LinkLabel
}

let nodeTypes = [NodeType.none]
for (let i = 1, name; name = Type[i]; i++)
  nodeTypes[i] = new (NodeType as any)(name, {}, i)
export const Group = new NodeGroup(nodeTypes)

function space(ch: number) { return ch == 32 || ch == 9 || ch == 10 || ch == 13 }

// FIXME more incremental
function countIndent(line: string, to: number) {
  let indent = 0
  for (let i = 0; i < to; i++) {
    let ch = line.charCodeAt(i)
    indent += ch == 9 ? 4 - indent % 4 : 1
  }
  return indent
}

function skipSpace(line: string, i = 0) {
  while (i < line.length && space(line.charCodeAt(i))) i++
  return i
}

function skipSpaceBack(line: string, i: number, to: number) {
  while (i > to && space(line.charCodeAt(i - 1))) i--
  return i
}

function isFencedCode(p: MarkdownParser, next: number, start: number) {
  if (next != 96 && next != 126 /* '`~' */) return -1
  let pos = start + 1
  while (pos < p.text.length && p.text.charCodeAt(pos) == next) pos++
  if (pos < start + 3) return -1
  if (next == 96) for (let i = pos; i < p.text.length; i++) if (p.text.charCodeAt(i) == 96) return -1
  return pos
}

function isBlockquote(p: MarkdownParser, next: number, start: number) {
  return next != 62 /* '>' */ ? -1 : p.text.charCodeAt(start + 1) == 32 ? 2 : 1
}

function isHorizontalRule(p: MarkdownParser, next: number, start: number) {
  if (next != 42 && next != 45 && next != 95 /* '-_*' */) return -1
  let count = 1
  for (let pos = start + 1; pos < p.text.length; pos++) {
    let ch = p.text.charCodeAt(pos)
    if (ch == next) count++
    else if (!space(ch)) return -1
  }
  return count < 3 ? -1 : 1
}

function inList(p: MarkdownParser, type: Type) {
  return p.context.type == type ||
    p.contextStack.length > 1 && p.contextStack[p.contextStack.length - 2].type == type
}

function isBulletList(p: MarkdownParser, next: number, start: number, breaking: boolean) {
  return (next == 45 || next == 43 || next == 42 /* '-+*' */) &&
    (start == p.text.length - 1 || space(p.text.charCodeAt(start + 1))) &&
    (!breaking || inList(p, Type.BulletList) || skipSpace(p.text, start + 2) < p.text.length) ? 1 : -1
}

function isOrderedList(p: MarkdownParser, first: number, start: number, breaking: boolean) {
  let pos = start, next = first
  for (;;) {
    if (next >= 48 && next <= 57 /* '0-9' */) pos++
    else break
    if (pos == p.text.length) return -1
    next = p.text.charCodeAt(pos)
  }
  if (pos == start || pos > start + 9 ||
      (next != 46 && next != 41 /* '.)' */) ||
      (pos < p.text.length - 1 && !space(p.text.charCodeAt(pos + 1))) ||
      breaking && !inList(p, Type.OrderedList) &&
      (skipSpace(p.text, pos + 1) == p.text.length || pos > start + 1 || first != 49 /* '1' */))
    return -1
  return pos + 1 - start
}

function isAtxHeading(p: MarkdownParser, next: number, start: number) {
  if (next != 35 /* '#' */) return -1
  let pos = start + 1
  while (pos < p.text.length && p.text.charCodeAt(pos) == 35) pos++
  if (pos < p.text.length && p.text.charCodeAt(pos) != 32) return -1
  let size = pos - start
  return size > 6 ? -1 : size + 1
}

const EmptyLine = /^[ \t]*$/, CommentEnd = /-->/
const HTMLBlockStyle = [
  [/^<(?:script|pre|style)(?:\s|>|$)/i, /<\/(?:script|pre|style)>/i],
  [/^\s*<!--/, CommentEnd],
  [/^\s*<\?/, /\?>/],
  [/^\s*<![A-Z]/, />/],
  [/^\s*<!\[CDATA\[/, /\]\]>/],
  [/^\s*<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i, EmptyLine],
  [/^\s*(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(\s+[a-z:_][\w-.]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)\s*$/i, EmptyLine]
]

function isHTMLBlock(p: MarkdownParser, next: number, start: number, breaking: boolean) {
  if (next != 60 /* '<' */) return -1
  let line = p.text.slice(start)
  for (let i = 0, e = HTMLBlockStyle.length - (breaking ? 1 : 0); i < e; i++)
    if (HTMLBlockStyle[i][0].test(line)) return i
  return -1
}

function isSetextUnderline(p: MarkdownParser, next: number, start: number) {
  if (next != 45 && next != 61 /* '-=' */) return -1
  let pos = start + 1
  while (pos < p.text.length && p.text.charCodeAt(pos) == next) pos++
  while (pos < p.text.length && space(p.text.charCodeAt(pos))) pos++
  return pos == p.text.length ? 1 : -1
}

const BreakParagraph: ((p: MarkdownParser, next: number, start: number, breaking: boolean) => number)[] = [
  isAtxHeading,
  isFencedCode,
  isBlockquote,
  isBulletList,
  isOrderedList,
  isHorizontalRule,
  isHTMLBlock
]

type SkipResult = {start: number, baseIndent: number, indent: number, depth: number, unmatched: number}

function skipForList(cx: BlockContext, p: MarkdownParser, result: SkipResult) {
  if (result.start == p.text.length ||
      (cx != p.context && result.indent >= p.contextStack[result.depth + 1].indent + result.baseIndent)) return true
  if (result.indent >= result.baseIndent + 4) return false
  let size = (cx.type == Type.OrderedList ? isOrderedList : isBulletList)(p, p.text.charCodeAt(result.start), result.start, false)
  return size > 0 &&
    (cx.type != Type.BulletList || isHorizontalRule(p, p.text.charCodeAt(result.start), result.start) < 0) &&
    p.text.charCodeAt(result.start + size - 1) == cx.markup
}

const SkipMarkup: {[type: number]: (cx: BlockContext, p: MarkdownParser, result: SkipResult, marks: Element[]) => boolean} = {
  [Type.Blockquote](_cx, p, result, marks) {
    if (p.text.charCodeAt(result.start) != 62 /* '>' */) return false
    marks.push(elt(Type.QuoteMark, p.pos + result.start, p.pos + result.start + 1))
    result.start = skipSpace(p.text, result.start + 1)
    result.baseIndent = result.indent + 2
    return true
  },
  [Type.ListItem](cx, p, result) {
    if (result.indent < result.baseIndent + cx.indent && result.start < p.text.length) return false
    result.baseIndent += cx.indent
    return true
  },
  [Type.OrderedList]: skipForList,
  [Type.BulletList]: skipForList
}

function getListIndent(text: string, start: number) {
  let indentAfter = countIndent(text, start) + 1
  let indented = countIndent(text, skipSpace(text, start))
  return indented >= indentAfter + 4 ? indentAfter : indented
}

// Rules for parsing blocks. A return value of false means the rule
// doesn't apply here, true means it does. When true is returned and
// `p.line` has been updated, the rule is assumed to have consumed a
// leaf block. Otherwise, it is assumed to have opened a context.
const Blocks: ((p: MarkdownParser, next: number, start: number, baseIndent: number) => boolean)[] = [
  function indentedCode(p, _next, start, baseIndent) {
    let indent = countIndent(p.text, start)
    if (indent < baseIndent + 4) return false
    // Rewind to start of necessary indentation
    for (; indent > baseIndent + 4; start--) {
      let ch = p.text.charCodeAt(start - 1)
      if (ch == 32) indent--
      else if (ch == 9) indent = countIndent(p.text, start - 1)
      else break
    }
    let from = p.pos + start, empty = 0
    let marks: Element[] = []
    for (; p.nextLine();) {
      let {start: skip, baseIndent, unmatched, indent} = p.skipBlockMarkup(marks)
      if (unmatched) break
      if (skip == p.text.length) empty++
      else if (indent < baseIndent + 4) break
      else empty = 0
    }
    for (let i = 0; i < empty; i++) p.prevLine()
    dropMarksAfter(marks, p.pos)
    return p.addNode(new Buffer().writeElements(marks, -from).finish(Type.CodeBlock, p.prevLineEnd() - from), from)
  },

  function fencedCode(p, next, start) {
    let fenceEnd = isFencedCode(p, next, start)
    if (fenceEnd < 0) return false
    let from = p.pos + start
    let buf = new Buffer().write(Type.CodeMark, 0, fenceEnd - start)
    let infoFrom = skipSpace(p.text, fenceEnd), infoTo = skipSpaceBack(p.text, p.text.length, infoFrom)
    if (infoFrom < infoTo) buf.write(Type.CodeInfo, infoFrom - start, infoTo - start)

    for (; p.nextLine();) {
      let marks: Element[] = []
      let {start: skip, unmatched, baseIndent, indent} = p.skipBlockMarkup(marks), i = skip
      if (unmatched) break
      buf.writeElements(marks, -from)
      if (indent - baseIndent < 4)
        while (i < p.text.length && p.text.charCodeAt(i) == next) i++
      if (i - skip >= fenceEnd - start && skipSpace(p.text, i) == p.text.length) {
        buf.write(Type.CodeMark, p.pos + skip - from, p.pos + i - from)
        p.nextLine()
        break
      }
    }
    return p.addNode(buf.finish(Type.FencedCode, p.prevLineEnd() - from), from)
  },

  function blockquote(p, next, start) {
    let size = isBlockquote(p, next, start)
    if (size < 0) return false
    p.startContext(Type.Blockquote, size, start, start + size)
    return p.addNode(Type.QuoteMark, p.pos + start, p.pos + start + 1)
  },

  function horizontalRule(p, next, start) {
    if (isHorizontalRule(p, next, start) < 0) return false
    let from = p.pos + start
    p.nextLine()
    return p.addNode(Type.HorizontalRule, from)
  },

  function bulletList(p, next, start, baseIndent) {
    let size = isBulletList(p, next, start, false)
    if (size < 0) return false
    if (p.context.type != Type.BulletList)
      p.startContext(Type.BulletList, 0, start, start, p.text.charCodeAt(start))
    p.startContext(Type.ListItem, getListIndent(p.text, start + 1) - baseIndent,
                   start, Math.min(p.text.length, start + 2))
    return p.addNode(Type.ListMark, p.pos + start, p.pos + start + size)
  },

  function orderedList(p, next, start, baseIndent) {
    let size = isOrderedList(p, next, start, false)
    if (size < 0) return false
    if (p.context.type != Type.OrderedList)
      p.startContext(Type.OrderedList, 0, start, start, p.text.charCodeAt(start + size - 1))
    p.startContext(Type.ListItem, getListIndent(p.text, start + size) - baseIndent,
                   start, Math.min(p.text.length, start + size + 1))
    return p.addNode(Type.ListMark, p.pos + start, p.pos + start + size)
  },

  function atxHeading(p, next, start) {
    let size = isAtxHeading(p, next, start)
    if (size < 0) return false
    let from = p.pos + start
    let endOfSpace = skipSpaceBack(p.text, p.text.length, start), after = endOfSpace
    while (after > start && p.text.charCodeAt(after - 1) == next) after--
    if (after == endOfSpace || after == start || !space(p.text.charCodeAt(after - 1))) after = p.text.length
    let buf = new Buffer()
      .write(Type.HeaderMark, 0, size - 1)
      .writeElements(parseInline(p.text.slice(start + size, after)), size)
    if (after < p.text.length) buf.write(Type.HeaderMark, after - start, endOfSpace - start)
    let node = buf.finish(Type.ATXHeading, p.text.length - start)
    p.nextLine()
    return p.addNode(node, from)
  },

  function htmlBlock(p, next, start) {
    let type = isHTMLBlock(p, next, start, false)
    if (type < 0) return false
    let from = p.pos + start, end = HTMLBlockStyle[type][1]
    let marks: Element[] = []
    while (!end.test(p.text) && p.nextLine()) {
      let {unmatched} = p.skipBlockMarkup(marks)
      if (unmatched) { dropMarksAfter(marks, p.pos); break }
    }
    if (end != EmptyLine) p.nextLine()
    return p.addNode(new Buffer().writeElements(marks, -from)
                     .finish(end == CommentEnd ? Type.Comment : Type.HTMLBlock, p.prevLineEnd() - from),
                     from)
  },

  function paragraph(p, _next, start) {
    let from = p.pos + start, content = p.text.slice(start), marks: Element[] = []
    let heading = false
    lines: for (; p.nextLine();) {
      let {start: skip, unmatched, baseIndent, indent} = p.skipBlockMarkup(marks)
      if (skip == p.text.length) break
      if (indent < baseIndent + 4) {
        let next = p.text.charCodeAt(skip)
        if (isSetextUnderline(p, next, skip) > -1 && !unmatched) {
          heading = true
          break
        }
        for (let check of BreakParagraph) if (check(p, next, skip, true) >= 0) break lines
      }
      content += "\n"
      content += p.text
    }

    dropMarksAfter(marks, heading ? p.pos + p.text.length : p.pos)
    content = clearMarks(content, marks, from)
    for (;;) {
      let ref = parseLinkReference(content)
      if (!ref) break
      p.addNode(ref, from)
      if (content.length <= ref.length + 1 && !heading) return true
      content = content.slice(ref.length + 1)
      from += ref.length + 1
      while (marks.length && marks[0].to <= from) marks.shift()
    }

    let inline = injectMarks(parseInline(content), marks, from)
    if (heading) {
      let node = new Buffer()
        .writeElements(inline)
        .write(Type.HeaderMark, p.pos - from, p.pos + p.text.length - from)
        .finish(Type.SetextHeading, p.pos + p.text.length - from)
      p.nextLine()
      return p.addNode(node, from)
    }
    let node = new Buffer()
      .writeElements(inline)
      .finish(Type.Paragraph, content.length)
    return p.addNode(node, from)
  }
]

const skipBlockResult: SkipResult = {
  start: 0,
  baseIndent: 0,
  indent: 0,
  depth: 0,
  unmatched: 0
}

export class MarkdownParser {
  context: BlockContext = new BlockContext(Type.Document, 0, 0, 0, 0)
  contextStack: BlockContext[] = [this.context]
  line = 0
  pos = 0
  text = ""

  constructor(readonly input: readonly string[]) {
    this.text = input[0]
  }

  parseBlock() {
    let start, baseIndent
    for (;;) {
      let markers: Element[] = []
      let result = this.skipBlockMarkup(markers)
      for (let i = 0; i < result.unmatched; i++) this.finishContext()
      for (let marker of markers) this.addNode(marker.type, marker.from, marker.to)

      if (result.start == this.text.length) {
        // Empty line
        if (!this.nextLine()) return false
      } else {
        start = result.start
        baseIndent = result.baseIndent
        break
      }
    }

    let next = this.text.charCodeAt(start), line = this.line
    for (;;) {
      for (let type of Blocks) {
        let result = type(this, next, start, baseIndent)
        if (result) {
          if (this.line != line) return true // Leaf block consumed
          // Only opened a context, content remains on the line
          baseIndent = countIndent(this.text, this.context.contentStart)
          start = skipSpace(this.text, this.context.contentStart)
          next = this.text.charCodeAt(start)
          break
        }
      }
    }
  }

  nextLine() {
    if (this.line >= this.input.length - 1) {
      if (this.line == this.input.length - 1) {
        this.pos += this.text.length
        this.line++
        this.text = ""
      }
      return false
    }
    this.pos += this.text.length + 1
    this.text = this.input[++this.line]
    return true
  }

  prevLine() {
    this.text = this.input[--this.line]
    this.pos -= this.text.length + (this.line == this.input.length - 1 ? 0 : 1)
  }

  skipBlockMarkup(marks: Element[]): SkipResult {
    let result = skipBlockResult
    let pos = result.start = skipSpace(this.text, 0)
    result.baseIndent = 0
    result.depth = 1
    result.indent = countIndent(this.text, result.start)
    for (; result.depth < this.contextStack.length; result.depth++) {
      let cx = this.contextStack[result.depth], handler = SkipMarkup[cx.type]
      if (!handler) throw new Error("Unhandled block context " + Type[cx.type])
      if (!handler(cx, this, result, marks)) break
      if (result.start != pos) result.indent = countIndent(this.text, pos = result.start)
    }
    result.unmatched = this.contextStack.length - result.depth
    return result
  }

  prevLineEnd() { return this.line == this.input.length ? this.pos : this.pos - 1 }

  startContext(type: Type, indent: number, start: number, contentStart: number, markup = 0) {
    this.context = new BlockContext(type, indent, this.pos + start, contentStart, markup)
    this.contextStack.push(this.context)
    return true
  }

  addNode(block: Type | Tree, from: number, to?: number) {
    if (typeof block == "number") block = new Tree(Group.types[block], none, none, (to ?? this.prevLineEnd()) - from)
    this.context.children.push(block)
    this.context.positions.push(from - this.context.from)
    return true
  }

  finishContext() {
    let cx = this.contextStack.pop()!
    this.context = this.contextStack[this.contextStack.length - 1]
    this.context.children.push(cx.toTree(this.prevLineEnd()))
    this.context.positions.push(cx.from - this.context.from)
  }

  finish() {
    while (this.contextStack.length > 1) this.finishContext()
    return this.context.toTree(this.pos)
  }
}

const none: readonly any[] = []

class Buffer {
  content: number[] = []

  write(type: Type, from: number, to: number, children = 0) {
    this.content.push(type, from, to, 4 + children * 4)
    return this
  }

  writeElements(elts: readonly Element[], offset = 0) {
    let write = (elt: Element) => {
      let startOff = this.content.length
      if (elt.children) for (let ch of elt.children) write(ch)
      this.content.push(elt.type, elt.from + offset, elt.to + offset, this.content.length + 4 - startOff)
    }
    elts.forEach(write)
    return this
  }

  finish(type: Type, length: number) {
    return Tree.build({
      buffer: this.content,
      group: Group,
      topID: type,
      length
    })
  }
}  

class Element {
  constructor(readonly type: Type,
              readonly from: number,
              readonly to: number,
              readonly children: readonly Element[] | null = null) {}

  cut(from: number, to: number): Element | null {
    if (from >= this.to || to <= this.from) return this
    if (from <= this.from && to >= this.to) return null
    return new Element(this.type, Math.max(from, this.from), Math.min(to, this.to),
                       this.children && this.children.map(c => c.cut(from, to)).filter(c => c) as Element[])
  }
}

function elt(type: Type, from: number, to: number, children?: readonly Element[]) {
  return new Element(type, from, to, children)
}

const enum Mark { Open = 1, Close = 2 }

class InlineMarker {
  constructor(readonly type: Type,
              readonly from: number,
              readonly to: number,
              public value: number) {}
}

const Escapable = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

let Punctuation = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1\u2010-\u2027]/
try { Punctuation = /[\p{Pc}|\p{Pd}|\p{Pe}|\p{Pf}|\p{Pi}|\p{Po}|\p{Ps}]/u } catch (_) {}

const InlineTokens: ((cx: InlineContext, next: number, pos: number) => number)[] = [
  function escape(cx, next, start) {
    if (next != 92 /* '\\' */ || start == cx.text.length - 1) return -1
    let escaped = cx.text.charCodeAt(start + 1)
    for (let i = 0; i < Escapable.length; i++) if (Escapable.charCodeAt(i) == escaped)
      return cx.append(elt(Type.Escape, start, start + 2))
    return -1
  },

  function entity(cx, next, start) {
    if (next != 38 /* '&' */) return -1
    let m = /^(?:#\d+|#x[a-f\d]+|\w+);/i.exec(cx.text.slice(start + 1, start + 31))
    return m ? cx.append(elt(Type.Entity, start, start + 1 + m[0].length)) : -1
  },

  function code(cx, next, start) {
    if (next != 96 /* '`' */ || start && cx.text.charCodeAt(start - 1) == 96) return -1
    let pos = start + 1
    while (pos < cx.text.length && cx.text.charCodeAt(pos) == 96) pos++
    let size = pos - start, curSize = 0
    for (; pos < cx.text.length; pos++) {
      if (cx.text.charCodeAt(pos) == 96) {
        curSize++
        if (curSize == size && cx.text.charCodeAt(pos + 1) != 96)
          return cx.append(elt(Type.InlineCode, start, pos + 1, [
            elt(Type.CodeMark, start, start + size),
            elt(Type.CodeMark, pos + 1 - size, pos + 1)
          ]))
      } else {
        curSize = 0
      }
    }
    return -1
  },

  function htmlTagOrURL(cx, next, start) {
    if (next != 60 /* '<' */ || start == cx.text.length - 1) return -1
    let after = cx.text.slice(start + 1)
    let url = /^(?:[a-z][-\w+.]+:[^\s>]+|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*)>/i.exec(after)
    if (url) return cx.append(elt(Type.URL, start, start + 1 + url[0].length))
    let comment = /^!--[^>](?:-[^-]|[^-])*?-->/i.exec(after)
    if (comment) return cx.append(elt(Type.Comment, start, start + 1 + comment[0].length))
    let m = /^(?:![A-Z][^]*?>|\?[^]*?\?>|!\[CDATA\[[^]*?\]\]>|\/\s*[a-zA-Z][\w-]*\s*>|\s*[a-zA-Z][\w-]*(\s+[a-zA-Z:_][\w-.:]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*(\/\s*)?>)/.exec(after)
    return m ? cx.append(elt(Type.HTMLTag, start, start + 1 + m[0].length)) : -1
  },

  function emphasis(cx, next, start) {
    if (next != 95 && next != 42) return -1
    let pos = start + 1
    while (pos < cx.text.length && cx.text.charCodeAt(pos) == next) pos++
    let before = cx.text.charAt(start - 1), after = cx.text.charAt(pos)
    let pBefore = Punctuation.test(before), pAfter = Punctuation.test(after)
    let sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after)
    let leftFlanking = !sAfter && (!pAfter || sBefore || pBefore)
    let rightFlanking = !sBefore && (!pBefore || sAfter || pAfter)
    let canOpen = leftFlanking && (next == 42 || !rightFlanking || pBefore)
    let canClose = rightFlanking && (next == 42 || !leftFlanking || pAfter)
    return cx.append(new InlineMarker(Type.Emphasis, start, pos, (canOpen ? Mark.Open : 0) | (canClose ? Mark.Close : 0)))
  },

  function hardBreak(cx, next, start) {
    if (next == 92 /* '\\' */ && cx.text.charCodeAt(start + 1) == 10 /* '\n' */)
      return cx.append(elt(Type.HardBreak, start, start + 2))
    if (next == 32) {
      let pos = start + 1
      while (pos < cx.text.length && cx.text.charCodeAt(pos) == 32) pos++
      if (cx.text.charCodeAt(pos) == 10 && pos >= start + 2)
        return cx.append(elt(Type.HardBreak, start, pos + 1))
    }
    return -1
  },

  function linkOpen(cx, next, start) {
    return next == 91 /* '[' */ ? cx.append(new InlineMarker(Type.Link, start, start + 1, 1)) : -1
  },

  function imageOpen(cx, next, start) {
    return next == 33 /* '!' */ && start < cx.text.length - 1 && cx.text.charCodeAt(start + 1) == 91 /* '[' */
      ? cx.append(new InlineMarker(Type.Image, start, start + 2, 1)) : -1
  },

  function linkEnd(cx, next, start) {
    if (next != 93 /* ']' */) return -1
    for (let i = cx.parts.length - 1; i >= 0; i--) {
      let part = cx.parts[i]
      if (part instanceof InlineMarker && (part.type == Type.Link || part.type == Type.Image)) {
        if (!part.value) {
          cx.parts[i] = null
          return -1
        }
        if (skipSpace(cx.text, part.to) == start && !/[(\[]/.test(cx.text[start + 1])) return -1
        let content = cx.resolveMarkers(i + 1)
        cx.parts.length = i
        let link = cx.parts[i] = finishLink(cx.text, content, part.type, part.from, start + 1)
        for (let j = 0; j < i; j++) {
          let p = cx.parts[j]
          if (part.type == Type.Link && p instanceof InlineMarker && p.type == Type.Link) p.value = 0
        }
        return link.to
      }
    }
    return -1
  },
]

function finishLink(text: string, content: Element[], type: Type, start: number, startPos: number) {
  let next = startPos < text.length ? text.charCodeAt(startPos) : -1, endPos = startPos
  content.unshift(elt(Type.LinkMark, start, start + (type == Type.Image ? 2 : 1)))
  content.push(elt(Type.LinkMark, startPos - 1, startPos))
  if (next == 40 /* '(' */) {
    let pos = skipSpace(text, startPos + 1)
    let dest = parseURL(text, pos), title
    if (dest) {
      pos = skipSpace(text, dest.to)
      title = parseLinkTitle(text, pos)
      if (title) pos = skipSpace(text, title.to)
    }
    if (text.charCodeAt(pos) == 41 /* ')' */) {
      content.push(elt(Type.LinkMark, startPos, startPos + 1))
      endPos = pos + 1
      if (dest) content.push(dest)
      if (title) content.push(title)
      content.push(elt(Type.LinkMark, pos, endPos))
    }
  } else if (next == 91 /* '[' */) {
    let label = parseLinkLabel(text, startPos, false)
    if (label) {
      content.push(label)
      endPos = label.to
    }
  }
  return elt(type, start, endPos, content)
}

function parseURL(text: string, start: number) {
  let next = text.charCodeAt(start)
  if (next == 60 /* '<' */) {
    for (let pos = start + 1; pos < text.length; pos++) {
      let ch = text.charCodeAt(pos)
      if (ch == 62 /* '>' */) return elt(Type.URL, start, pos + 1)
      if (ch == 60 || ch == 10 /* '<\n' */) break
    }
    return null
  } else {
    let depth = 0, pos = start
    for (let escaped = false; pos < text.length; pos++) {
      let ch = text.charCodeAt(pos)
      if (space(ch)) {
        break
      } else if (escaped) {
        escaped = false
      } else if (ch == 40 /* '(' */) {
        depth++
      } else if (ch == 41 /* ')' */) {
        if (!depth) break
        depth--
      } else if (ch == 92 /* '\\' */) {
        escaped = true
      }
    }
    return pos > start ? elt(Type.URL, start, pos) : null
  }
}

function parseLinkTitle(text: string, start: number) {
  let next = text.charCodeAt(start)
  if (next != 39 && next != 34 && next != 40 /* '"\'(' */) return null
  let end = next == 40 ? 41 : next
  for (let pos = start + 1, escaped = false; pos < text.length; pos++) {
    let ch = text.charCodeAt(pos)
    if (escaped) escaped = false
    else if (ch == end) return elt(Type.LinkTitle, start, pos + 1)
    else if (ch == 92 /* '\\' */) escaped = true
  }
  return null
}

function parseLinkLabel(text: string, start: number, requireNonWS: boolean) {
  for (let escaped = false, pos = start + 1, end = Math.min(text.length, pos + 999); pos < end; pos++) {
    let ch = text.charCodeAt(pos)
    if (escaped) escaped = false
    else if (ch == 93 /* ']' */) return requireNonWS ? null : elt(Type.LinkLabel, start, pos + 1)
    else {
      if (requireNonWS && !space(ch)) requireNonWS = false
      if (ch == 91 /* '[' */) break
      else if (ch == 92 /* '\\' */) escaped = true
    }
  }
  return null
}

function lineEnd(text: string, pos: number) {
  for (; pos < text.length; pos++) {
    let next = text.charCodeAt(pos)
    if (next == 10) break
    if (!space(next)) return -1
  }
  return pos
}

function parseLinkReference(text: string) {
  if (text.charCodeAt(0) != 91 /* '[' */) return null
  let ref = parseLinkLabel(text, 0, true)
  if (!ref || text.charCodeAt(ref.to) != 58 /* ':' */) return null
  let elts = [ref, elt(Type.LinkMark, ref.to, ref.to + 1)]
  let url = parseURL(text, skipSpace(text, ref.to + 1))
  if (!url) return null
  elts.push(url)
  let pos = skipSpace(text, url.to), title, end = 0
  if (pos > url.to && (title = parseLinkTitle(text, pos))) {
    let afterURL = lineEnd(text, title.to)
    if (afterURL > 0) {
      elts.push(title)
      end = afterURL
    }
  }
  if (end == 0) end = lineEnd(text, url.to)
  return end < 0 ? null : new Buffer().writeElements(elts).finish(Type.LinkReference, end)
}

class InlineContext {
  parts: (Element | InlineMarker | null)[] = []

  constructor(readonly text: string) {}

  append(elt: Element | InlineMarker) {
    this.parts.push(elt)
    return elt.to
  }

  resolveMarkers(from: number) {
    for (let i = from; i < this.parts.length; i++) {
      let close = this.parts[i]
      if (!(close instanceof InlineMarker && close.type == Type.Emphasis && (close.value & Mark.Close))) continue

      let type = this.text.charCodeAt(close.from), closeSize = close.to - close.from
      let open: InlineMarker | undefined, openSize = 0, j = i - 1
      for (; j >= from; j--) {
        let part = this.parts[j] as InlineMarker
        if (!(part instanceof InlineMarker && (part.value & Mark.Open) && this.text.charCodeAt(part.from) == type)) continue
        openSize = part.to - part.from
        if (!((close.value & Mark.Open) || (part.value & Mark.Close)) ||
            (openSize + closeSize) % 3 || (openSize % 3 == 0 && closeSize % 3 == 0)) {
          open = part
          break
        }
      }
      if (!open) continue

      let size = Math.min(2, openSize, closeSize)
      let start = open.to - size, end: number = close.from + size, content = [elt(Type.EmphasisMark, start, open.to)]
      for (let k = j + 1; k < i; k++) {
        if (this.parts[k] instanceof Element) content.push(this.parts[k] as Element)
        this.parts[k] = null
      }
      content.push(elt(Type.EmphasisMark, close.from, end))
      let element = elt(size == 1 ? Type.Emphasis : Type.StrongEmphasis, open.to - size, close.from + size, content)
      this.parts[j] = open.from == start ? null : new InlineMarker(open.type, open.from, start, open.value)
      let keep = this.parts[i] = close.to == end ? null : new InlineMarker(close.type, end, close.to, close.value)
      if (keep) this.parts.splice(i, 0, element)
      else this.parts[i] = element
    }

    let result = []
    for (let i = from; i < this.parts.length; i++) {
      let part = this.parts[i]
      if (part instanceof Element) result.push(part)
    }
    return result
  }
}

function parseInline(text: string) {
  let cx = new InlineContext(text)
  outer: for (let pos = 0; pos < text.length;) {
    let next = text.charCodeAt(pos)
    for (let token of InlineTokens) {
        let result = token(cx, next, pos)
      if (result >= 0) { pos = result; continue outer }
    }
    pos++
  }
  return cx.resolveMarkers(0)
}

function clearMarks(content: string, marks: Element[], offset: number) {
  if (!marks.length) return content
  let result = "", pos = 0
  for (let m of marks) {
    let from = m.from - offset, to = m.to - offset
    result += content.slice(pos, from)
    for (let i = from; i < to; i++) result += " "
    pos = to
  }
  result += content.slice(pos)
  return result
}

function injectMarks(elts: Element[], marks: Element[], offset: number) {
  let eI = 1, cur: Element | null = elts.length ? elts[0] : null
  let result = []
  for (let mark of marks) {
    let from = mark.from - offset, to = mark.to - offset
    while (cur && cur.from < to) {
      if (cur.from < from) result.push(cur.cut(cur.from, from)!)
      if (cur.to > to) cur = cur.cut(to, cur.to)!
      else cur = eI < elts.length ? elts[eI++] : null
    }
    result.push(elt(mark.type, from, to))
  }
  if (cur) result.push(cur)
  while (eI < elts.length) result.push(elts[eI++])
  return result
}

function dropMarksAfter(marks: Element[], pos: number) {
  while (marks.length && marks[marks.length - 1].to > pos) marks.pop()
}
