import {Text} from "../../doc/src"
import {EditorState} from "../../state/src"
import {combineConfig} from "../../extension/src/extension"
import {ViewExtension} from "../../view/src/"
import {Decoration, DecorationSet, RangeDecoration} from "../../view/src/decoration"

const matching: {[key: string]: string | undefined} = {
  "(": ")>",
  ")": "(<",
  "[": "]>",
  "]": "[<",
  "{": "}>",
  "}": "{<"
}

export type Config = {
  afterCursor?: boolean,
  decorationsPlugin?: Plugin,
  bracketRegex?: RegExp,
  maxScanDistance?: number,
  strict?: boolean,
}

function getStyle(decorations: DecorationSet | undefined, at: number): string | void {
  if (!decorations) return
  const iter = decorations.iter()
  let decoration
  while (decoration = iter.next())
    if (decoration.from <= at && at < decoration.to)
      return (decoration.value as RangeDecoration).spec.class
}

export function findMatchingBracket(
  doc: Text, decorations: DecorationSet | undefined,
  where: number, config: Config = {}
) : {from: number, to: number | null, forward: boolean, match: boolean} | null {
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
// maxScanDistance and gave up
export function scanForBracket(doc: Text, decorations: DecorationSet | undefined,
                               where: number, dir: -1 | 1, style: string | null, config: Config) {
  const maxScanDistance = config.maxScanDistance || 10000
  const re = config.bracketRegex || /[(){}[\]]/
  const stack = []
  const iter = doc.iterRange(where, dir > 0 ? doc.length : 0)
  for (let distance = 0; !iter.done && distance <= maxScanDistance;) {
    iter.next()
    const text = iter.value
    if (dir < 0) distance += text.length
    const basePos = where + distance * dir
    for (let pos = dir > 0 ? 0 : text.length - 1, end = dir > 0 ? text.length : -1; pos != end; pos += dir) {
      const ch = text.charAt(pos)
      if (re.test(ch) && (style === undefined || getStyle(decorations, basePos + pos) == style)) {
        const match = matching[ch]!
        if ((match.charAt(1) == ">") == (dir > 0)) stack.push(ch)
        else if (!stack.length) return {pos: basePos + pos, ch}
        else stack.pop()
      }
    }
    if (dir > 0) distance += text.length
  }
  return iter.done ? false : null
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

export const matchBrackets = ViewExtension.unique((configs: Config[]) => {
  let config = combineConfig(configs)
  return ViewExtension.decorations({
    create(view) { return Decoration.none },
    update({state}, {transactions}, deco) {
      // FIXME make this use a tokenizer behavior exported by the highlighter
      return transactions.length ? doMatchBrackets(state, undefined, config) : deco
    }
  })
}, {})
