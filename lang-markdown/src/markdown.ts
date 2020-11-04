import {Tree, NodeType, NodeGroup} from "lezer-tree"

class BlockContext {
  readonly children: Tree[] = []
  readonly positions: number[] = []

  constructor(readonly type: number,
              readonly indent: number,
              readonly startPos: number,
              // FIXME communicate differently? Only needed at start
              readonly contentStart: number) {}

  toTree(end: number) {
    return new Tree(group.types[this.type], this.children, this.positions, end - this.startPos)
  }
}

enum Type {
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
  Paragraph,

  // Inline
  Text,
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
  StrongEmphasisMark,
  CodeMark,
  LinkTitle,
  LinkLabel
}

let nodeTypes = [NodeType.none]
for (let i = 1, name; name = Type[i]; i++)
  nodeTypes[i] = new (NodeType as any)(name, {}, i)
let group = new NodeGroup(nodeTypes)

function space(ch: number) { return ch == 32 || ch == 9 || ch == 10 || ch == 13 }

function countIndent(line: string, to: number) {
  let indent = 0
  for (let i = 0; i < to; i++) {
    let ch = line.charCodeAt(i)
    indent += ch == 9 ? 4 - indent % 4 : 1
  }
  return indent
}

function skipSpace(line: string, start = 0) {
  let i = start
  while (i < line.length && space(line.charCodeAt(i))) i++
  return i
}

function skipFor(contexts: readonly BlockContext[], line: string) {
  let pos = 0, cxI = 0
  scan: for (; pos < line.length; pos++) {
    let next = line.charCodeAt(pos)
    if (next == 62 /* '>' */) {
      for (;;) {
        if (cxI == contexts.length) break scan
        if (contexts[cxI++].type == Type.Blockquote) break
      }
    } else if (!space(next)) {
      break
    }
  }
  return pos
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
  let pos = start + 1
  while (pos < p.text.length && p.text.charCodeAt(pos) == next) pos++
  if (pos - start < 3) return -1
  for (; pos < p.text.length; pos++) if (!space(p.text.charCodeAt(pos))) return -1
  return 1
}

function isBulletList(p: MarkdownParser, next: number, start: number) {
  return (next == 45 || next == 43 || next == 42 /* '-+*' */) && p.text.charCodeAt(start + 1) == 32 ? 2 : -1
}

function isOrderedList(p: MarkdownParser, next: number, start: number) {
  let pos = start
  for (;;) {
    if (next >= 48 && next <= 57 /* '0-9' */) pos++
    else break
    if (pos == p.text.length) return -1
    next = p.text.charCodeAt(pos)
  }
  return pos == start || (next != 46 && next != 41 /* '.)' */) ? -1 : pos + 1
}

function isAtxHeading(p: MarkdownParser, next: number, start: number) {
  if (next != 35 /* '#' */) return -1
  let pos = start + 1
  while (pos < p.text.length && p.text.charCodeAt(pos) == 35) pos++
  if (p.text.charCodeAt(pos) != 32) return -1
  return pos + 1 - start
}

const EmptyLine = /^[ \t]*$/
const HTMLBlockStyle = [
  [/^<(?:script|pre|style)(?:\s|>|$)/i, /<\/(?:script|pre|style)>/i],
  [/^\s*<!--/, /-->/],
  [/^\s*<\?/, /\?>/],
  [/^\s*<!\[CDATA\[/, /\]\]>/],
  [/^\s*<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/, EmptyLine]
]

function isHTMLBlock(p: MarkdownParser, next: number, start: number) {
  if (next != 60 /* '<' */) return -1
  let line = p.text.slice(start)
  for (let i = 0; i < HTMLBlockStyle.length; i++)
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

const BreakParagraph: ((p: MarkdownParser, next: number, start: number) => number)[] = [
  isAtxHeading,
  isFencedCode,
  isBlockquote,
  isBulletList,
  isOrderedList,
  isHorizontalRule,
  isHTMLBlock
]

// Rules for parsing blocks. A return value of false means the rule
// doesn't apply here, true means it does. When true is returned and
// `p.line` has been updated, the rule is assumed to have consumed a
// leaf block. Otherwise, it is assumed to have opened a context.
const Blocks: ((p: MarkdownParser, next: number, start: number, indent: number) => boolean)[] = [
  function code(p, _next, start, indent) {
    let base = p.contextIndent + 4
    if (indent < base) return false
    let from = p.pos + start
    let empty = 0
    for (; p.nextLine();) {
      let skip = skipFor(p.contextStack, p.text)
      if (skip == p.text.length) {
        empty++
      } else if (countIndent(p.text, skip) < base) {
        for (let i = 0; i < empty; i++) p.prevLine()
        break
      } else {
        empty = 0
      }
    }
    return p.addNode(Type.CodeBlock, from)
  },

  function fencedCode(p, next, start) {
    let fenceEnd = isFencedCode(p, next, start)
    if (fenceEnd < 0) return false
    let from = p.pos + start
    lines: for (; p.nextLine();) {
      let skip = skipFor(p.contextStack, p.text), i = skip
      while (i < p.text.length && p.text.charCodeAt(i) == next) i++
      if (i - skip < fenceEnd - start) continue
      for (;; i++) {
        if (i == p.text.length) { p.nextLine(); break lines }
        if (p.text.charCodeAt(i) != 32) continue lines
      }
    }
    return p.addNode(Type.FencedCode, from)
  },

  function blockquote(p, next, start, indent) {
    let size = isBlockquote(p, next, start)
    if (size < 0) return false
    p.startContext(Type.Blockquote, indent + size, start + size)
    return p.addNode(Type.QuoteMark, p.pos + start, p.pos + start + 1)
  },

  function horizontalRule(p, next, start) {
    if (isHorizontalRule(p, next, start) < 0) return false
    let from = p.pos + start
    p.nextLine()
    return p.addNode(Type.HorizontalRule, from)
  },

  function bulletList(p, next, start, indent) {
    let size = isBulletList(p, next, start)
    if (size < 0) return false
    if (p.context.type != Type.BulletList)
      p.startContext(Type.BulletList, indent, start)
    p.startContext(Type.ListItem, indent + size, start + size)
    return p.addNode(Type.ListMark, p.pos + start, p.pos + start + 1)
  },

  function orderedList(p, next, start, indent) {
    let size = isOrderedList(p, next, start)
    if (size < 0) return false
    if (p.context.type != Type.OrderedList)
      p.startContext(Type.OrderedList, indent, start)
    p.startContext(Type.ListItem, indent + size, start + size)
    return p.addNode(Type.ListMark, p.pos + start, p.pos + start + size)
  },

  function atxHeading(p, next, start) {
    let size = isAtxHeading(p, next, start)
    if (size < 0) return false
    let from = p.pos + start
    let node = (new Buffer)
      .write(Type.HeaderMark, 0, size - 1)
      .writeInline(parseInline(p.text.slice(start + size)), size)
      .finish(Type.ATXHeading)
    p.nextLine()
    return p.addNode(node, from)
  },

  function htmlBlock(p, next, start) {
    let type = isHTMLBlock(p, next, start)
    if (type < 0) return false
    let from = p.pos + start, end = HTMLBlockStyle[type][1]
    while (!end.test(p.text) && p.nextLine()) {}
    if (end != EmptyLine) p.nextLine()
    return p.addNode(Type.HTMLBlock, from)
  },

  // FIXME references

  function paragraph(p, _next, start) {
    let from = p.pos + start, content = p.text.slice(start)
    lines: for (; p.nextLine();) {
      let skip = skipFor(p.contextStack, p.text)
      if (skip == p.text.length) break
      let indent = countIndent(p.text, skip)
      if (indent >= 4) continue
      let next = p.text.charCodeAt(skip)
      if (isSetextUnderline(p, next, skip) > -1) {
        let node = new Buffer()
          .writeInline(parseInline(content))
          .write(Type.HeaderMark, p.pos - from, p.pos + p.text.length - from)
          .finish(Type.SetextHeading)
        p.nextLine()
        return p.addNode(node, from)
      }
      for (let check of BreakParagraph) if (check(p, next, skip) >= 0) break lines
      content += "\n"
      content += p.text.slice(skip)
    }
    let node = new Buffer().writeInline(parseInline(content)).finish(Type.Paragraph)
    return p.addNode(node, from)
  }
]

class MarkdownParser {
  context: BlockContext = new BlockContext(Type.Document, 0, 0, 0)
  contextStack: BlockContext[] = [this.context]
  line = 0
  pos = 0
  text = ""

  constructor(readonly input: readonly string[]) {
    this.readLine()
  }

  parseBlock() {
    let start = 0, indent = 0
    for (;;) {
      start = skipSpace(this.text)
      indent = countIndent(this.text, start)
      for (let i = 1; i < this.contextStack.length; i++) {
        let cx = this.contextStack[i], okay = false
        if (cx.type == Type.Blockquote) {
          okay = this.text.charCodeAt(start) == 62 /* '>' */
          if (okay) {
            start = skipSpace(this.text, start + 1)
            indent = countIndent(this.text, start)
          }
        } else if (cx.type == Type.ListItem) {
          okay = start == this.text.length || indent >= cx.indent
        } else if (cx.type == Type.OrderedList || cx.type == Type.BulletList) {
          okay = start == this.text.length || indent >= this.contextStack[i + 1].indent ||
            indent == cx.indent && (cx.type == Type.OrderedList ? /^\s*\d+[\).] / : /^\s*[-*+] /).test(this.text.slice(start))
        } else {
          throw new Error("Unhandled block context " + cx.type)
        }
        if (!okay) while (this.contextStack.length > i) this.finishContext()
      }
      if (start < this.text.length) break
      if (!this.nextLine()) return false
    }

    let next = this.text.charCodeAt(start), line = this.line
    for (;;) {
      for (let type of Blocks) {
        let result = type(this, next, start, indent)
        if (result) {
          if (this.line != line) return true // Leaf block consumed
          // Only opened a context, content remains on the line
          start = this.context.contentStart
          indent = this.context.indent
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
    this.line++
    this.readLine()
    return true
  }

  prevLine() {
    this.line--
    this.readLine()
    this.pos -= this.text.length + (this.line == this.input.length - 2 ? 0 : 1)
  }

  readLine() {
    this.text = this.input[this.line]
  }

  prevLineEnd() { return this.line == this.input.length ? this.pos : this.pos - 1 }

  startContext(type: Type, indent: number, contentStart: number) {
    this.context = new BlockContext(type, indent, this.pos, contentStart)
    this.contextStack.push(this.context)
    return true
  }

  addNode(block: Type | Tree, from: number, to?: number) {
    if (typeof block == "number") block = new Tree(group.types[block], [], [], (to ?? this.prevLineEnd()) - from)
    this.context.children.push(block)
    this.context.positions.push(from - this.context.startPos)
    return true
  }

  finishContext() {
    let cx = this.contextStack.pop()!
    this.context = this.contextStack[this.contextStack.length - 1]
    this.context.children.push(cx.toTree(this.pos))
    this.context.positions.push(cx.startPos - this.context.startPos)
  }

  get contextIndent() {
    return this.context ? this.context.indent : 0
  }

  finish() {
    while (this.contextStack.length > 1) this.finishContext()
    return this.context.toTree(this.pos)
  }
}

class Buffer {
  content: number[] = []

  write(type: Type, from: number, to: number, children = 0) {
    this.content.push(type, from, to, 4 + children * 4)
    return this
  }

  writeInline(elt: Element, offset = 0) {
    let startOff = this.content.length
    if (elt.children) for (let ch of elt.children) this.writeInline(ch, offset)
    this.content.push(elt.type, elt.from + offset, elt.to + offset, this.content.length + 4 - startOff)
    return this
  }

  finish(type: Type) {
    return Tree.build({
      buffer: this.content,
      group,
      topID: type
    })
  }
}  

class Element {
  constructor(readonly type: Type,
              readonly from: number,
              readonly to: number,
              readonly children: readonly Element[] | null = null) {}
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
    let m = /^(?:#\d+|#x[a-f\d]+|\w+);/.exec(cx.text.slice(start + 1, start + 11))
    return m ? cx.append(elt(Type.Entity, start, start + 1 + m[0].length)) : -1
  },

  function code(cx, next, start) {
    if (next != 96 /* '`' */) return -1
    let pos = start + 1
    while (pos < cx.text.length && cx.text.charCodeAt(pos) == 96) pos++
    let size = pos - start, curSize = 0
    for (; pos < cx.text.length; pos++) {
      if (cx.text.charCodeAt(pos) == 96) {
        curSize++
        if (curSize == size) return cx.append(elt(Type.InlineCode, start, pos + 1))
      } else {
        curSize = 0
      }
    }
    return -1
  },

  function htmlTag(cx, next, start) {
    if (next != 60 /* '<' */ || start == cx.text.length - 1) return -1
    let m = /^(?:!--[^]*?-->|![A-Z][^]*?>|\?[^]*?\?>|!\[CDATA\[[^]*?\]\]>|\/[a-z][\w-]*\s*>|[a-z][\w-]*(\s+[a-z:_][\w-.]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)/.exec(cx.text.slice(start + 1))
    return m ? cx.append(elt(Type.HTMLTag, start, start + 1 + m[0].length)) : -1
  },

  function emphasis(cx, next, start) {
    if (next != 95 && next != 42) return -1
    let pos = start + 1
    while (pos < cx.text.length && cx.text.charCodeAt(pos) == next) pos++
    let before = cx.text.charAt(start - 1), after = cx.text.charAt(pos)
    let pBefore = Punctuation.test(before), pAfter = Punctuation.test(after), sBefore = /\s/.test(before), sAfter = /\s/.test(after)
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
      if (cx.text.charCodeAt(pos) == 10) return cx.append(elt(Type.HardBreak, start, pos + 1))
    }
    return -1
  },

  // FIXME urls

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
        let content = cx.resolveMarkers(i + 1)
        cx.parts.length = i
        let link = cx.parts[i] = finishLink(cx.text, content, part.type, part.from, start + 1)
        for (let j = 0; j < i; j++) {
          let p = cx.parts[j]
          if (p instanceof InlineMarker && p.type == Type.Link) p.value = 0
        }
        return link.to
      }
    }
    return -1
  }
]

function finishLink(text: string, content: Element[], type: Type, start: number, startPos: number) {
  let next = startPos < text.length ? text.charCodeAt(startPos) : -1, endPos = startPos
  content.unshift(elt(Type.LinkMark, start, start + (type == Type.Image ? 2 : 1)))
  if (next == 40 /* '(' */) {
    let pos = skipSpace(text, startPos + 1)
    let dest = parseURL(text, pos)
    if (dest) {
      pos = skipSpace(text, dest.to)
      let title = parseLinkTitle(text, pos)
      if (title) pos = skipSpace(text, title.to)
      if (text.charCodeAt(pos) == 41 /* ')' */) {
        content.push(elt(Type.LinkMark, startPos - 1, startPos + 1))
        endPos = pos + 1
        content.push(dest)
        if (title) content.push(title)
        content.push(elt(Type.LinkMark, pos, endPos))
      }
    }
  } else if (next == 91 /* '[' */) {
    content.push(elt(Type.LinkMark, startPos - 1, startPos))
    let label = parseLinkLabel(text, startPos)
    if (label) {
      content.push(label)
      endPos = label.to + 1
    }
  }
  return elt(type, start, endPos, content)
}

function parseURL(text: string, start: number) {
  let next = text.charCodeAt(start)
  if (next == 60 /* '<' */) {
    for (let pos = start + 1; pos < text.length; pos++) {
      let ch = text.charCodeAt(pos)
      if (ch == 62 /* '>' */) return pos == start + 1 ? null : elt(Type.URL, start, pos + 1)
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

function parseLinkLabel(text: string, start: number) {
  for (let escaped = false, pos = start + 1, end = Math.min(text.length, pos + 999); pos < end; pos++) {
    let ch = text.charCodeAt(pos)
    if (escaped) escaped = false
    else if (ch == 93 /* ']' */) return elt(Type.LinkLabel, start + 1, pos)
    else if (ch == 92 /* '\\' */) escaped = true
  }
  return null
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
      if (close instanceof InlineMarker && close.type == Type.Emphasis && (close.value & Mark.Close)) {
        let type = this.text.charCodeAt(close.from)
        for (let j = i - 1; j >= from; j--) {
          let open = this.parts[j]
          if (open instanceof InlineMarker && (open.value & Mark.Open) && this.text.charCodeAt(open.from) == type) {
            let openSize = open.to - open.from, closeSize: number = close.to - close.from, size = Math.min(2, openSize, closeSize)
            let marker = size == 2 ? Type.StrongEmphasisMark : Type.EmphasisMark
            let content = [elt(marker, open.to - size, open.to)]
            for (let k = j + 1; k < i; k++) {
              let p = this.parts[k]
              if (p instanceof Element) content.push(p)
              this.parts[k] = null
            }
            content.push(elt(marker, close.from, close.from + size))
            let element = elt(size == 1 ? Type.Emphasis : Type.StrongEmphasis, open.to - size, close.from + size, content)
            // FIXME this kludge doesn't work when sizes are both > 3
            if (size == 2 && openSize == 3 && closeSize == 3) {
              size++
              element = elt(Type.Emphasis, open.from, close.to, [elt(Type.EmphasisMark, open.from, open.from + 1),
                                                                 element,
                                                                 elt(Type.EmphasisMark, close.to - 1, close.to)])
            }
            this.parts[j] = openSize == size ? null : new InlineMarker(open.type, open.from, open.to - size, open.value)
            this.parts[i] = closeSize == size ? null : close = new InlineMarker(close.type, close.from + size, close.to, close.value)
            this.parts[openSize == size ? j : i] = element
            if (closeSize == size) break
          }
        }
      }
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
  return elt(Type.Text, 0, text.length, cx.resolveMarkers(0))
}

let p = new MarkdownParser("1. Woop *abc* and a [link][ink]\n *too **yay***".split("\n"))
while (p.parseBlock()) {}
console.log("" + p.finish())
