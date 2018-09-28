import {Text} from "../../doc/src"
import {EditorState, Plugin} from "../../state/src"
import {EditorView} from "../../view/src/"
import {Decoration, DecorationSet, RangeDecoration} from "../../view/src/decoration"

const matching: {[key: string]: string | undefined} = {"(": ")>", ")": "(<", "[": "]>", "]": "[<", "{": "}>", "}": "{<"}

export type Config = {
  afterCursor?: boolean,
  decorationsPlugin?: Plugin,
  bracketRegex?: RegExp,
  maxScanLineLength?: number,
  maxScanLines?: number,
  strict?: boolean,
}

function getStyle(decorations: DecorationSet | undefined, at: number): string | void {
  if (!decorations) return
  const iter = decorations.iter()
  let decoration
  while (decoration = iter.next())
    if (decoration.from <= at && at < decoration.to)
      return (decoration.value as RangeDecoration).class
}

export function findMatchingBracket(doc: Text, decorations: DecorationSet | undefined, where: number, config: Config = {}): {from: number, to: number | null, forward: boolean, match: boolean} | null {
  let pos = where - 1
  // A cursor is defined as between two characters, but in in vim command mode
  // (i.e. not insert mode), the cursor is visually represented as a
  // highlighted box on top of the 2nd character. Otherwise, we allow matches
  // from before or after the cursor.
  const match = (!config.afterCursor && pos >= 0 && matching[doc.slice(pos, pos + 1)]) ||
      matching[doc.slice(++pos, pos + 1)]
  if (!match) return null
  const dir = match[1] == ">" ? 1 : -1
  if (config.strict && (dir > 0) != (pos == where)) return null
  const style = getStyle(decorations, pos)

  const found = scanForBracket(doc, decorations, pos + (dir > 0 ? 1 : 0), dir, style || null, config)
  if (found == null) return null
  return {from: pos, to: found ? found.pos : null,
          match: found && found.ch == match.charAt(0), forward: dir > 0}
}

// bracketRegex is used to specify which type of bracket to scan
// should be a regexp, e.g. /[[\]]/
//
// Note: If "where" is on an open bracket, then this bracket is ignored.
//
// Returns false when no bracket was found, null when it reached
// maxScanLines and gave up
export function scanForBracket(doc: Text, decorations: DecorationSet | undefined, where: number, dir: -1 | 1, style: string | null, config: Config) {
  const maxScanLen = config.maxScanLineLength || 10000
  const maxScanLines = config.maxScanLines || 1000

  const stack = []
  const re = config.bracketRegex || /[(){}[\]]/
  const linePos = doc.linePos(where)
  const lineEnd = dir > 0 ? Math.min(linePos.line + maxScanLines, doc.lines + 1)
                          : Math.max(1, linePos.line - maxScanLines)
  let lineNo
  for (lineNo = linePos.line; lineNo != lineEnd; lineNo += dir) {
    // FIXME don't pull in lines one at a time, since that might incur a lot of string concatenation for long lines
    const line = doc.line(lineNo).slice()
    if (line.length > maxScanLen) continue
    let pos = dir > 0 ? 0 : line.length - 1, end = dir > 0 ? line.length : -1
    if (lineNo == linePos.line) pos = linePos.pos - (dir < 0 ? 1 : 0)
    const lineStart = doc.lineStart(lineNo)
    for (; pos != end; pos += dir) {
      const ch = line.charAt(pos)
      if (re.test(ch) && (style === undefined || getStyle(decorations, lineStart + pos) == style)) {
        const match = matching[ch]!
        if ((match.charAt(1) == ">") == (dir > 0)) stack.push(ch)
        else if (!stack.length) return {pos: lineStart + pos, ch}
        else stack.pop()
      }
    }
  }
  return lineNo - dir == (dir > 0 ? doc.lines : 1) ? false : null
}

function doMatchBrackets(state: EditorState, referenceDecorations: DecorationSet | undefined, config: Config) {
  const decorations = []
  for (const range of state.selection.ranges) {
    if (!range.empty) continue
    const match = findMatchingBracket(state.doc, referenceDecorations, range.head, config)
    if (!match) continue
    const style = match.match ? "CodeMirror-matchingbracket" : "CodeMirror-nonmatchingbracket"
    decorations.push(Decoration.range(match.from, match.from + 1, {class: style}))
    if (match.to) decorations.push(Decoration.range(match.to, match.to + 1, {class: style}))
  }
  return Decoration.set(decorations)
}

export function matchBrackets(config: Config = {}) {
  return new Plugin({
    view(v: EditorView) {
      const idx = config.decorationsPlugin && v.state.plugins.filter(p => p.view).indexOf(config.decorationsPlugin)
      let decorations = Decoration.none
      return {
        get decorations() { return decorations },
        updateState(v: EditorView) {
          const refDecos = idx == undefined ? undefined : v.pluginViews[idx].decorations
          decorations = doMatchBrackets(v.state, refDecos, config)
        }
      }
    }
  })
}
