import {EditorState, StateExtension} from "../../state/src"
import {combineConfig} from "../../extension/src/extension"
import {ViewExtension, ViewField} from "../../view/src/"
import {Decoration} from "../../view/src/decoration"
import {Tree, Subtree, Tag} from "lezer-tree"

export interface Config {
  afterCursor?: boolean,
  brackets?: string,
  maxScanDistance?: number
}

const DEFAULT_SCAN_DIST = 10000, DEFAULT_BRACKETS = "()[]{}"

export const bracketMatching = ViewExtension.unique((configs: Config[]) => {
  let config = combineConfig(configs, {
    afterCursor: true,
    brackets: DEFAULT_BRACKETS,
    maxScanDistance: DEFAULT_SCAN_DIST
  })

  return ViewExtension.all(
    ViewField.decorations({
      create() { return Decoration.none },
      update(deco, update) {
        if (!update.transactions.length) return deco
        let {state} = update, decorations = []
        for (let range of state.selection.ranges) {
          if (!range.empty) continue
          let match = matchBrackets(state, range.head, -1, config)
            || (range.head > 0 && matchBrackets(state, range.head - 1, 1, config))
            || (config.afterCursor &&
                (matchBrackets(state, range.head, 1, config) ||
                 (range.head < state.doc.length && matchBrackets(state, range.head + 1, -1, config))))
          if (!match) continue
          let style = update.view.themeClass(match.matched ? "brackets.matching" : "brackets.nonmatching") +
            ` codemirror-${match.matched ? "" : "non"}matching-bracket`
          decorations.push(Decoration.mark(match.start.from, match.start.to, {class: style}))
          if (match.end) decorations.push(Decoration.mark(match.end.from, match.end.to, {class: style}))
        }
        return Decoration.set(decorations)
      }
    })
  )
}, {})

function getTree(state: EditorState, pos: number, dir: number, maxScanDistance: number) {
  for (let syntax of state.behavior.get(StateExtension.syntax)) {
    return syntax.tryGetTree(state, dir < 0 ? Math.max(0, pos - maxScanDistance) : pos,
                             dir < 0 ? pos : Math.min(state.doc.length, pos + maxScanDistance))
  }
  return Tree.empty
}

type MatchResult = {start: {from: number, to: number}, end?: {from: number, to: number}, matched: boolean} | null

function isBracket(tag: Tag, type: "open" | "close") {
  return tag.parts[tag.parts.length - 1] == "punctuation" && tag.parts.some(p => p == type)
}

function matches(tag: Tag, other: Tag) {
  for (let i = 1;; i++) {
    let iTag = tag.parts.length - i, iOther = other.parts.length - i
    if (iTag < 0 || iOther < 0) return false
    let pTag = tag.parts[iTag], pOther = other.parts[iOther]
    if (pTag != pOther)
      return pTag == "open" && pOther == "close" || pTag == "close" && pOther == "open"
  }
}

export function matchBrackets(state: EditorState, pos: number, dir: -1 | 1, config: Config = {}): MatchResult {
  let maxScanDistance = config.maxScanDistance || DEFAULT_SCAN_DIST
  let tree = getTree(state, pos, dir, maxScanDistance)
  let sub = tree.resolve(pos, dir)
  if (isBracket(sub.tag, dir < 0 ? "close" : "open"))
    return matchMarkedBrackets(state, pos, dir, sub, sub.tag, maxScanDistance)
  else
    return matchPlainBrackets(state, pos, dir, tree, sub.tag, maxScanDistance, config.brackets || DEFAULT_BRACKETS)
}

function matchMarkedBrackets(state: EditorState, pos: number, dir: -1 | 1, token: Subtree,
                             startTag: Tag, maxScanDistance: number) {
  let depth = 0, firstToken = {from: token.start, to: token.end}
  let to = dir < 0 ? Math.max(0, pos - maxScanDistance) : Math.min(state.doc.length, pos + maxScanDistance)
  return token.root.iterate(pos, to, (tag, start, end) => {
    if (dir < 0 ? end > pos : start < pos) return
    if (isBracket(tag, dir < 0 ? "close" : "open")) {
      depth++
    } else if (isBracket(tag, dir < 0 ? "open" : "close")) {
      if (depth == 1) return {start: firstToken, end: {from: start, to: end}, matched: matches(tag, startTag)}
      else depth--
    }
    return
  }) || {start: firstToken, matched: false}
}

function matchPlainBrackets(state: EditorState, pos: number, dir: number, tree: Tree,
                            tokenType: Tag, maxScanDistance: number, brackets: string) {
  let startCh = dir < 0 ? state.doc.slice(pos - 1, pos) : state.doc.slice(pos, pos + 1)
  let bracket = brackets.indexOf(startCh)
  if (bracket < 0 || (bracket % 2 == 0) != (dir > 0)) return null

  let startToken = {from: dir < 0 ? pos - 1 : pos, to: dir > 0 ? pos + 1 : pos}
  let iter = state.doc.iterRange(pos, dir > 0 ? state.doc.length : 0), depth = 0
  for (let distance = 0; !(iter.next()).done && distance <= maxScanDistance;) {
    let text = iter.value
    if (dir < 0) distance += text.length
    let basePos = pos + distance * dir
    for (let pos = dir > 0 ? 0 : text.length - 1, end = dir > 0 ? text.length : -1; pos != end; pos += dir) {
      let found = brackets.indexOf(text[pos])
      if (found < 0 || tree.resolve(basePos + pos, 1).tag.tag != tokenType.tag) continue // FIXME refine this
      if ((found % 2 == 0) == (dir > 0)) {
        depth++
      } else if (depth == 1) { // Closing
        return {start: startToken, end: {from: basePos + pos, to: basePos + pos + 1}, matched: (found >> 1) == (bracket >> 1)}
      } else {
        depth--
      }
    }
    if (dir > 0) distance += text.length
  }
  return iter.done ? {start: startToken, matched: false} : null
}
