import {Text} from "../../doc/src"
import {EditorState} from "../../state/src"
import {combineConfig, Full} from "../../extension/src/extension"
import {ViewExtension, ViewField, styleModule} from "../../view/src/"
import {Decoration} from "../../view/src/decoration"
import {StyleModule} from "style-mod"

const matching: {[key: string]: string | undefined} = {
  "(": ")>",
  ")": "(<",
  "[": "]>",
  "]": "[<",
  "{": "}>",
  "}": "{<"
}

export interface Config {
  afterCursor?: boolean,
  bracketRegex?: RegExp,
  maxScanDistance?: number,
  strict?: boolean,
}

function findMatchingBracket(
  doc: Text, where: number, config: Full<Config>
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

  const found = scanForBracket(doc, pos + (dir > 0 ? 1 : 0), dir, config)
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
export function scanForBracket(doc: Text, where: number, dir: -1 | 1, config: Full<Config>) {
  const maxScanDistance = config.maxScanDistance
  const re = config.bracketRegex
  const stack = []
  const iter = doc.iterRange(where, dir > 0 ? doc.length : 0)
  for (let distance = 0; !iter.done && distance <= maxScanDistance;) {
    iter.next()
    const text = iter.value
    if (dir < 0) distance += text.length
    const basePos = where + distance * dir
    for (let pos = dir > 0 ? 0 : text.length - 1, end = dir > 0 ? text.length : -1; pos != end; pos += dir) {
      const ch = text.charAt(pos)
      if (re.test(ch)) {
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

function doMatchBrackets(state: EditorState, config: Full<Config>) {
  const decorations = []
  for (const range of state.selection.ranges) {
    if (!range.empty) continue
    const match = findMatchingBracket(state.doc, range.head, config)
    if (!match) continue
    const style = match.match ? defaultStyles.matching : defaultStyles.nonmatching
    decorations.push(Decoration.mark(match.from, match.from + 1, {class: style}))
    if (match.to) decorations.push(Decoration.mark(match.to, match.to + 1, {class: style}))
  }
  return Decoration.set(decorations)
}

export const matchBrackets = ViewExtension.unique((configs: Config[]) => {
  let config = combineConfig(configs, {
    afterCursor: false,
    bracketRegex: /[(){}[\]]/,
    maxScanDistance: 10000,
    strict: false
  })
  return ViewExtension.all(
    ViewField.decorations({
      create() { return Decoration.none },
      update(deco, update) {
        // FIXME make this use a tokenizer behavior exported by the highlighter
        return update.transactions.length ? doMatchBrackets(update.state, config) : deco
      }
    }),
    styleModule(defaultStyles)
  )
}, {})

// FIXME themeability
const defaultStyles = new StyleModule({
  matching: {color: "#0b0"},
  nonmatching: {color: "#a22"}
})
