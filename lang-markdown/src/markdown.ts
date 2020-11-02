import {Tree, NodeType, NodeGroup} from "lezer-tree"

class BlockContext {
  constructor(readonly type: number,
              readonly indent: number,
              readonly startPos: number,
              readonly startOffset: number,
              // FIXME communicate differently? Only needed at start
              readonly contentStart: number) {}
}

enum BlockType {
  Code = 1,
  FencedCode,
  Blockquote,
  HorizontalRule,
  BulletList,
  OrderedList,
  ListItem,
  ATXHeading,
  SetextHeading,
  HTMLBlock,
  Paragraph
}

function space(ch: number) { return ch == 32 || ch == 9 }

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
        if (contexts[cxI++].type == BlockType.Blockquote) break
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

const Blocks: {
  [name: string]: (p: MarkdownParser, next: number, start: number, indent: number) => BlockType | -1 | null
} = {
  code: (p, _next, _start, indent) => {
    let base = p.contextIndent + 4
    if (indent < base) return null
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
    return BlockType.Code
  },

  fencedCode: (p, next, start) => {
    let fenceEnd = isFencedCode(p, next, start)
    if (fenceEnd < 0) return null
    lines: for (; p.nextLine();) {
      let skip = skipFor(p.contextStack, p.text), i = skip
      while (i < p.text.length && p.text.charCodeAt(i) == next) i++
      if (i - skip < fenceEnd - start) continue
      for (;; i++) {
        if (i == p.text.length) { p.nextLine(); break lines }
        if (p.text.charCodeAt(i) != 32) continue lines
      }
    }
    return BlockType.FencedCode
  },

  blockquote: (p, next, start, indent) => {
    let size = isBlockquote(p, next, start)
    return size < 0 ? null : p.startContext(BlockType.Blockquote, indent + size, start + size)
  },

  horizontalRule: (p, next, start) => {
    return isHorizontalRule(p, next, start) < 0 ? null : BlockType.HorizontalRule
  },

  bulletList: (p, next, start, indent) => {
    let size = isBulletList(p, next, start)
    if (size < 0) return null
    p.startContext(BlockType.BulletList, indent, start)
    p.startContext(BlockType.ListItem, indent + size, start + size)
    return -1
  },

  orderedList: (p, next, start, indent) => {
    let size = isOrderedList(p, next, start)
    p.startContext(BlockType.OrderedList, indent, start)
    p.startContext(BlockType.ListItem, indent + size, start + size)
    return -1
  },

  atxHeading: (p, next, start) => {
    let size = isAtxHeading(p, next, start)
    if (size < 0) return null
    p.nextLine()
    return BlockType.ATXHeading
  },

  htmlBlock: (p, next, start) => {
    let type = isHTMLBlock(p, next, start)
    if (type < 0) return null
    let end = HTMLBlockStyle[type][1]
    while (!end.test(p.text) && p.nextLine()) {}
    if (end != EmptyLine) p.nextLine()
    return BlockType.HTMLBlock
  },

  // FIXME references

  paragraph: (p) => {
    for (; p.nextLine();) {
      let skip = skipFor(p.contextStack, p.text)
      if (skip == p.text.length) break
      let indent = countIndent(p.text, skip)
      if (indent >= 4) continue
      let next = p.text.charCodeAt(skip)
      if (isSetextUnderline(p, next, skip) > -1) {
        p.nextLine()
        return BlockType.SetextHeading
      }
      for (let check of BreakParagraph) if (check(p, next, skip) < 0) break
    }
    return BlockType.Paragraph
  }
}

const BlockStarts = Object.keys(Blocks).map(k => Blocks[k])

class MarkdownParser {
  contextStack: BlockContext[] = []
  context: BlockContext | null = null
  buffer: number[] = []
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
      for (let i = 0; i < this.contextStack.length; i++) {
        let cx = this.contextStack[i], okay = false
        if (cx.type == BlockType.Blockquote) {
          okay = this.text.charCodeAt(start) == 62 /* '>' */
          if (okay) {
            start = skipSpace(this.text, start + 1)
            indent = countIndent(this.text, start)
          }
        } else if (cx.type == BlockType.ListItem) {
          okay = start == this.text.length || indent >= cx.indent
        } else if (cx.type == BlockType.OrderedList || cx.type == BlockType.BulletList) {
          okay = start == this.text.length || indent >= this.contextStack[i + 1].indent ||
            indent == cx.indent && (cx.type == BlockType.OrderedList ? /^\s\d+[).] / : /^\s[-*+] /).test(this.text.slice(start))
        } else {
          throw new Error("Unhandled block context " + cx.type)
        }
        if (!okay) while (this.contextStack.length > i) this.finishContext()
      }
      if (start < this.text.length) break
      if (!this.nextLine()) return false
    }
    // FIXME context closing
    let next = this.text.charCodeAt(start), pos = this.pos + start
    for (;;) {
      for (let type of BlockStarts) {
        let result = type(this, next, start, indent)
        if (result == -1) {
          start = this.context!.contentStart
          indent = this.context!.indent
          next = this.text.charCodeAt(start)
          break
        } else if (result != null) {
          this.buffer.push(result, pos, this.line == this.input.length ? this.pos : this.pos - 1, 4)
          return true
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

  startContext(type: BlockType, indent: number, contentStart: number) {
    this.context = new BlockContext(type, indent, this.pos, this.buffer.length, contentStart)
    this.contextStack.push(this.context)
    return -1
  }

  finishContext() {
    let cx = this.contextStack.pop()!
    this.buffer.push(cx.type, cx.startPos, this.pos, this.buffer.length + 4 - cx.startOffset)
    this.context = this.contextStack.length ? this.contextStack[this.contextStack.length - 1] : null
  }

  get contextIndent() {
    return this.context ? this.context.indent : 0
  }

  finish() {
    while (this.contextStack.length) this.finishContext()
    return Tree.build({buffer: this.buffer, group})
  }
}

let nodeTypes = [NodeType.none]
for (let i = 1, name; name = BlockType[i]; i++)
  nodeTypes[i] = new (NodeType as any)(name, {}, i)
let group = new NodeGroup(nodeTypes)

let p = new MarkdownParser("hi\n\n1. List\n\n   More?\n2. Other".split("\n"))
while (p.parseBlock()) {}
console.log("" + p.finish())
