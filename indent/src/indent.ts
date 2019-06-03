import {TagMap, TreeContext, TERM_ERR} from "lezer"
import {LezerSyntax} from "../../syntax/src/syntax"
import {EditorState, StateExtension} from "../../state/src/"

export const indentUnit = StateExtension.defineBehavior<number>()

const DEFAULT_INDENT_UNIT = 2

export function getIndentUnit(state: EditorState) {
  let values = state.behavior.get(indentUnit)
  return values.length ? values[0] : DEFAULT_INDENT_UNIT
}

// FIXME handle nested syntaxes

export function syntaxIndentation(syntax: LezerSyntax, strategies: TagMap<IndentStrategy>) {
  return StateExtension.indentation((state, pos) => {
    let inner = new IndentContextInner(pos, strategies, syntax, state)
    let cx: TreeContext | null = syntax.getTree(state, pos, pos).resolve(pos)
    // Enter previous nodes that end in empty error terms, which means
    // they were broken off by error recovery, so that indentation
    // works even if the constructs haven't been finished.
    for (let scan = cx!, scanPos = pos;;) {
      let last = scan.childBefore(scanPos)
      if (!last) break
      if (last.type == TERM_ERR && last.start == last.end) {
        cx = scan
        scanPos = last.start
      } else {
        scan = last
        scanPos = scan.end + 1
      }
    }

    for (; cx; cx = cx.parent) {
      let strategy = strategies.get(cx.type) || (cx.parent == null ? topStrategy : null)
      if (strategy) {
        let indentContext = new IndentContext(inner, cx, strategy, null)
        return indentContext.getIndent()
      }
    }
    return -1
  })
}

export class IndentContextInner {
  unit: number

  constructor(readonly pos: number,
              readonly strategies: TagMap<IndentStrategy>,
              readonly syntax: LezerSyntax,
              readonly state: EditorState) {
    this.unit = getIndentUnit(state)
  }
}

export class IndentContext {
  private _next: IndentContext | null = null

  constructor(private inner: IndentContextInner,
              readonly context: TreeContext,
              readonly strategy: IndentStrategy,
              readonly prev: IndentContext | null) {}

  get syntax() { return this.inner.syntax }
  get state() { return this.inner.state }
  get pos() { return this.inner.pos }
  get unit() { return this.inner.unit }

  get next() {
    if (this._next) return this._next
    let last = this.context, found = null
    for (let cx = this.context.parent; !found && cx; cx = cx.parent) {
      found = this.inner.strategies.get(cx.type)
      last = cx
    }
    return this._next = new IndentContext(this.inner, last, found || topStrategy, this)
  }

  get textAfter() {
    return this.state.doc.slice(this.pos, Math.min(this.pos + 50, this.state.doc.lineAt(this.pos).end)).match(/^\s*(.*)/)![1]
  }

  getIndent() { return this.strategy.getIndent(this) }

  baseIndent() {
    let f = this.strategy.baseIndent
    return f ? f(this) : -1
  }

  get startLine() {
    return this.state.doc.lineAt(this.context.start)
  }

  get textBefore() {
    let line = this.startLine
    return line.slice(0, this.context.start - line.start)
  }

  countColumn(line: string, pos: number) {
    if (pos < 0) pos = line.length
    let tab = this.state.tabSize
    for (var i = 0, n = 0;;) {
      let nextTab = line.indexOf("\t", i);
      if (nextTab < 0 || nextTab >= pos) return n + (pos - i)
      n += nextTab - i
      n += tab - (n % tab)
      i = nextTab + 1
    }
  }

  get lineIndent() {
    let line = this.textBefore
    return this.countColumn(line, line.search(/\S/))
  }

  column(pos: number) {
    let line = this.state.doc.lineAt(pos)
    return this.countColumn(line.slice(0, pos - line.start), pos - line.start)
  }
}

export interface IndentStrategy {
  getIndent: (context: IndentContext) => number
  baseIndent?: (context: IndentContext) => number
}

export const topStrategy: IndentStrategy = {
  getIndent() { return 0 },
  baseIndent() { return 0 }
}

function bracketedAligned(context: IndentContext) {
  let cx = context.context
  let openToken = cx.childAfter(cx.start)
  if (!openToken) return null
  let openLine = context.state.doc.lineAt(openToken.start)
  for (let pos = openToken.end;;) {
    let next = cx.childAfter(pos)
    if (!next) return null
    if (!context.syntax.parser.isSkipped(next.type))
      return next.start < openLine.end ? openToken : null
    pos = next.end
  }
}

export function bracketed({closing, align = true}: {closing: string, align?: boolean}): IndentStrategy {
  return {
    getIndent(context: IndentContext) {
      let closed = context.textAfter.slice(0, closing.length) == closing
      let aligned = align ? bracketedAligned(context) : null
      if (aligned) return closed ? context.column(aligned.start) : context.column(aligned.end)
      return context.next.baseIndent() + (closed ? 0 : context.unit)
    },
    baseIndent(context: IndentContext) {
      let newLine = context.startLine.start != context.prev!.startLine.start
      let aligned = align && newLine ? bracketedAligned(context) : null
      if (aligned) return context.column(aligned.end)
      return context.next.baseIndent() + (newLine ? context.unit : 0)
    }
  }
}

export const parens = bracketed({closing: ")"}), braces = bracketed({closing: "}"}), brackets = bracketed({closing: "]"})

export const statement: IndentStrategy = {
  getIndent(context: IndentContext) {
    return context.baseIndent() + context.unit
  },
  baseIndent(context: IndentContext) {
    return context.lineIndent
  }
}

export function compositeStatement(dedentBefore: RegExp): IndentStrategy {
  return {
    getIndent(context: IndentContext) {
      return context.baseIndent() + (dedentBefore.test(context.textAfter) ? 0 : context.unit)
    },
    baseIndent(context: IndentContext) {
      return context.lineIndent
    }
  }
}

export const dontIndent: IndentStrategy = {
  getIndent() { return -1 }
}
