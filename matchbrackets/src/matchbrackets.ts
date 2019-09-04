import {EditorState} from "../../state/src"
import {Extension, combineConfig} from "../../extension/src/extension"
import {EditorView, ViewField} from "../../view/src/"
import {Decoration} from "../../view/src/decoration"
import {Tree, Subtree, NodeType} from "lezer-tree"
import {openNodeProp, closeNodeProp} from "../../syntax/src/"

export interface Config {
  afterCursor?: boolean,
  brackets?: string,
  maxScanDistance?: number
}

const DEFAULT_SCAN_DIST = 10000, DEFAULT_BRACKETS = "()[]{}"

export const bracketMatching = EditorView.extend.unique((configs: Config[]) => {
  let config = combineConfig(configs, {
    afterCursor: true,
    brackets: DEFAULT_BRACKETS,
    maxScanDistance: DEFAULT_SCAN_DIST
  })

  return Extension.all(
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
          let style = update.view.themeClass(match.matched ? "bracket.matching" : "bracket.nonmatching") +
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
  for (let syntax of state.behavior.get(EditorState.syntax)) {
    return syntax.getPartialTree(state, dir < 0 ? Math.max(0, pos - maxScanDistance) : pos,
                                 dir < 0 ? pos : Math.min(state.doc.length, pos + maxScanDistance))
  }
  return Tree.empty
}

type MatchResult = {start: {from: number, to: number}, end?: {from: number, to: number}, matched: boolean} | null

function matchingNodes(node: NodeType, dir: -1 | 1, brackets: string): null | readonly string[] {
  let byProp = node.prop(dir < 0 ? closeNodeProp : openNodeProp)
  if (byProp) return byProp
  if (node.name.length == 1) {
    let index = brackets.indexOf(node.name)
    if (index > -1 && index % 2 == (dir < 0 ? 1 : 0))
      return [brackets[index + dir]]
  }
  return null
}

export function matchBrackets(state: EditorState, pos: number, dir: -1 | 1, config: Config = {}): MatchResult {
  let maxScanDistance = config.maxScanDistance || DEFAULT_SCAN_DIST, brackets = config.brackets || DEFAULT_BRACKETS
  let tree = getTree(state, pos, dir, maxScanDistance)
  let sub = tree.resolve(pos, dir), matches
  if (matches = matchingNodes(sub.type, dir, brackets))
    return matchMarkedBrackets(state, pos, dir, sub, matches, maxScanDistance, brackets)
  else
    return matchPlainBrackets(state, pos, dir, tree, sub.type, maxScanDistance, brackets)
}

function matchMarkedBrackets(state: EditorState, pos: number, dir: -1 | 1, token: Subtree,
                             matching: readonly string[], maxScanDistance: number, brackets: string) {
  let parent = token.parent, firstToken = {from: token.start, to: token.end}
  let depth = 0
  return (parent && parent.iterate(dir < 0 ? token.start : token.end, dir < 0 ? parent.start : parent.end, (type, from, to) => {
    if (dir < 0 ? to > token.start : from < token.end) return undefined
    if (depth == 0 && matching.includes(type.name)) {
      return {start: firstToken, end: {from, to}, matched: true}
    } else if (matchingNodes(type, dir, brackets)) {
      depth++
    } else if (matchingNodes(type, -dir as -1 | 1, brackets)) {
      depth--
      if (depth == 0) return {start: firstToken, end: {from, to}, matched: false}
    }
    return false
  })) || {start: firstToken, matched: false}
}

function matchPlainBrackets(state: EditorState, pos: number, dir: number, tree: Tree,
                            tokenType: NodeType, maxScanDistance: number, brackets: string) {
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
      if (found < 0 || tree.resolve(basePos + pos, 1).type != tokenType) continue
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
