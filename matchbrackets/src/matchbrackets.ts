import {combineConfig, EditorState, Facet, StateField, Extension} from "@codemirror/next/state"
import {syntaxTree} from "@codemirror/next/language"
import {EditorView, themeClass} from "@codemirror/next/view"
import {Decoration, DecorationSet} from "@codemirror/next/view"
import {Tree, SyntaxNode, NodeType, NodeProp} from "lezer-tree"

interface Config {
  /// Whether the bracket matching should look at the character after
  /// the cursor when matching (if the one before isn't a bracket).
  /// Defaults to true.
  afterCursor?: boolean,
  /// The bracket characters to match, as a string of pairs. Defaults
  /// to `"()[]{}"`. Note that these are only used as fallback when
  /// there is no [matching
  /// information](https://lezer.codemirror.net/docs/ref/#tree.NodeProp^closedBy)
  /// in the syntax tree.
  brackets?: string,
  /// The maximum distance to scan for matching brackets. This is only
  /// relevant for brackets not encoded in the syntax tree. Defaults
  /// to 10 000.
  maxScanDistance?: number
}

const baseTheme = EditorView.baseTheme({
  $matchingBracket: {color: "#0b0"},
  $nonmatchingBracket: {color: "#a22"}
})

const DefaultScanDist = 10000, DefaultBrackets = "()[]{}"

const bracketMatchingConfig = Facet.define<Config, Required<Config>>({
  combine(configs) {
    return combineConfig(configs, {
      afterCursor: true,
      brackets: DefaultBrackets,
      maxScanDistance: DefaultScanDist
    })
  }
})

const matchingMark = Decoration.mark({class: themeClass("matchingBracket")}),
      nonmatchingMark = Decoration.mark({class: themeClass("nonmatchingBracket")})

const bracketMatchingState = StateField.define<DecorationSet>({
  create() { return Decoration.none },
  update(deco, tr) {
    if (!tr.docChanged && !tr.selection) return deco
    let decorations = []
    let config = tr.state.facet(bracketMatchingConfig)
    for (let range of tr.state.selection.ranges) {
      if (!range.empty) continue
      let match = matchBrackets(tr.state, range.head, -1, config)
        || (range.head > 0 && matchBrackets(tr.state, range.head - 1, 1, config))
        || (config.afterCursor &&
            (matchBrackets(tr.state, range.head, 1, config) ||
             (range.head < tr.state.doc.length && matchBrackets(tr.state, range.head + 1, -1, config))))
      if (!match) continue
      let mark = match.matched ? matchingMark : nonmatchingMark
      decorations.push(mark.range(match.start.from, match.start.to))
      if (match.other) decorations.push(mark.range(match.other.from, match.other.to))
    }
    return Decoration.set(decorations, true)
  },
  provide: [EditorView.decorations]
})

const bracketMatchingUnique = [
  bracketMatchingState,
  baseTheme
]

/// Create an extension that enables bracket matching. Whenever the
/// cursor is next to a bracket, that bracket and the one it matches
/// are highlighted. Or, when no matching bracket is found, another
/// highlighting style is used to indicate this.
export function bracketMatching(config: Config = {}): Extension {
  return [bracketMatchingConfig.of(config), bracketMatchingUnique]
}

function matchingNodes(node: NodeType, dir: -1 | 1, brackets: string): null | readonly string[] {
  let byProp = node.prop(dir < 0 ? NodeProp.openedBy : NodeProp.closedBy)
  if (byProp) return byProp
  if (node.name.length == 1) {
    let index = brackets.indexOf(node.name)
    if (index > -1 && index % 2 == (dir < 0 ? 1 : 0))
      return [brackets[index + dir]]
  }
  return null
}


/// The result returned from `matchBrackets`.
export interface MatchResult {
  /// The extent of the bracket token found.
  start: {from: number, to: number},
  /// The extent of the matched token, if any was found.
  other?: {from: number, to: number},
  /// Whether the tokens match. This can be false even when `end` has
  /// a value, if that token doesn't match the opening token.
  matched: boolean
}

/// Find the matching bracket for the token at `pos`, scanning
/// direction `dir`. Only the `brackets` and `maxScanDistance`
/// properties are used from `config`, if given. Returns null if no
/// bracket was found at `pos`, or a match result otherwise.
export function matchBrackets(state: EditorState, pos: number, dir: -1 | 1, config: Config = {}): MatchResult | null {
  let maxScanDistance = config.maxScanDistance || DefaultScanDist, brackets = config.brackets || DefaultBrackets
  let tree = syntaxTree(state), sub = tree.resolve(pos, dir), matches
  if (matches = matchingNodes(sub.type, dir, brackets))
    return matchMarkedBrackets(state, pos, dir, sub, matches, brackets)
  else
    return matchPlainBrackets(state, pos, dir, tree, sub.type, maxScanDistance, brackets)
}

function matchMarkedBrackets(_state: EditorState, _pos: number, dir: -1 | 1, token: SyntaxNode,
                             matching: readonly string[], brackets: string) {
  let parent = token.parent, firstToken = {from: token.from, to: token.to}
  let depth = 0, cursor = parent?.cursor
  if (cursor && (dir < 0 ? cursor.childBefore(token.from) : cursor.childAfter(token.to))) do {
    if (dir < 0 ? cursor.to <= token.from : cursor.from >= token.to) {
      if (depth == 0 && matching.indexOf(cursor.type.name) > -1) {
        return {start: firstToken, end: {from: cursor.from, to: cursor.to}, matched: true}
      } else if (matchingNodes(cursor.type, dir, brackets)) {
        depth++
      } else if (matchingNodes(cursor.type, -dir as -1 | 1, brackets)) {
        depth--
        if (depth == 0) return {start: firstToken, end: {from: cursor.from, to: cursor.to}, matched: false}
      }
    }
  } while (dir < 0 ? cursor.prevSibling() : cursor.nextSibling())
  return {start: firstToken, matched: false}
}

function matchPlainBrackets(state: EditorState, pos: number, dir: number, tree: Tree,
                            tokenType: NodeType, maxScanDistance: number, brackets: string) {
  let startCh = dir < 0 ? state.sliceDoc(pos - 1, pos) : state.sliceDoc(pos, pos + 1)
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
