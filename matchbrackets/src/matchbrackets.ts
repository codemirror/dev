import {EditorState, StateExtension} from "../../state/src"
import {combineConfig} from "../../extension/src/extension"
import {ViewExtension, ViewField} from "../../view/src/"
import {Decoration} from "../../view/src/decoration"
import {Tree, Subtree, TagMap} from "lezer-tree"
import {tokenTypes} from "../../highlight/src/highlight"

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
    let tokens = syntax.getSlot(tokenTypes)
    if (tokens) {
      let tree = syntax.tryGetTree(state, dir < 0 ? Math.max(0, pos - maxScanDistance) : pos,
                                   dir < 0 ? pos : Math.min(state.doc.length, pos + maxScanDistance))
      return {tree, tokens}
    }
  }
  return {tree: Tree.empty, tokens: TagMap.empty}
}

const BRACKET_TYPE = /\bpunctuation\.([^\.]+)\.(open|close)\b/

type MatchResult = {start: {from: number, to: number}, end?: {from: number, to: number}, matched: boolean} | null

export function matchBrackets(state: EditorState, pos: number, dir: -1 | 1, config: Config = {}): MatchResult {
  let maxScanDistance = config.maxScanDistance || DEFAULT_SCAN_DIST
  let {tokens, tree} = getTree(state, pos, dir, maxScanDistance)
  let sub = tree.resolve(pos, dir)
  let tokenType = tokens.get(sub.type)
  let marked = tokenType && BRACKET_TYPE.exec(tokenType)
  if (marked && marked[2] == (dir < 0 ? "close" : "open"))
    return matchMarkedBrackets(state, pos, dir, sub, tokens, marked[1], maxScanDistance)
  else
    return matchPlainBrackets(state, pos, dir, tree, tokens, tokenType, maxScanDistance, config.brackets || DEFAULT_BRACKETS)
}

function matchMarkedBrackets(state: EditorState, pos: number, dir: -1 | 1, token: Subtree, tokens: TagMap<string>,
                             bracketType: string, maxScanDistance: number) {
  let depth = 0, firstToken = {from: token.start, to: token.end}
  let to = dir < 0 ? Math.max(0, pos - maxScanDistance) : Math.min(state.doc.length, pos + maxScanDistance)
  return token.root.iterate(pos, to, (type, start, end) => {
    if (dir < 0 ? end > pos : start < pos) return
    let tokenType = tokens.get(type)
    let bracket = tokenType && BRACKET_TYPE.exec(tokenType)
    if (bracket) {
      if (bracket[2] == (dir < 0 ? "close" : "open")) depth++
      else if (depth == 1) return {start: firstToken, end: {from: start, to: end}, matched: bracketType == bracket[1]}
      else depth--
    }
    return
  }) || {start: firstToken, matched: false}
}

function matchPlainBrackets(state: EditorState, pos: number, dir: number, tree: Tree, tokens: TagMap<string>,
                            tokenType: string | null, maxScanDistance: number, brackets: string) {
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
      if (found < 0 || tokens.get(tree.resolve(basePos + pos, 1).type) != tokenType) continue
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
