import {combineConfig, EditorState, EditorSelection, Facet, StateField, Extension,
        StateCommand, Transaction} from "@codemirror/next/state"
import {EditorView, themeClass} from "@codemirror/next/view"
import {Decoration, DecorationSet} from "@codemirror/next/view"
import {Tree, Subtree, NodeType, NodeProp} from "lezer-tree"

/// Configuration options
export interface Config {
  /// Whether the bracket matching should look at the character after
  /// the cursor when matching (if the one before isn't a bracket).
  /// Defaults to true.
  afterCursor?: boolean,
  /// The bracket characters to match, as a string of pairs. Defaults
  /// to `"()[]{}"`. Note that these are only used as fallback when
  /// there is no [matching information](#syntax.openNodeProp) in the
  /// syntax tree.
  brackets?: string,
  /// The maximum distance to scan for matching brackets. This is only
  /// relevant for brackets not encoded in the syntax tree. Defaults
  /// to 10 000.
  maxScanDistance?: number
}

const baseTheme = EditorView.baseTheme({
  matchingBracket: {color: "#0b0"},
  nonmatchingBracket: {color: "#a22"}
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
  update(deco, tr, state) {
    if (!tr.docChanged && !tr.selection) return deco
    let decorations = []
    let config = state.facet(bracketMatchingConfig)
    for (let range of state.selection.ranges) {
      if (!range.empty) continue
      let match = matchBrackets(state, range.head, -1, config)
        || (range.head > 0 && matchBrackets(state, range.head - 1, 1, config))
        || (config.afterCursor &&
            (matchBrackets(state, range.head, 1, config) ||
             (range.head < state.doc.length && matchBrackets(state, range.head + 1, -1, config))))
      if (!match) continue
      let mark = match.matched ? matchingMark : nonmatchingMark
      decorations.push(mark.range(match.start.from, match.start.to))
      if (match.end) decorations.push(mark.range(match.end.from, match.end.to))
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
  end?: {from: number, to: number}, // FIXME rename
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
  let tree = state.tree, sub = tree.resolve(pos, dir), matches
  if (matches = matchingNodes(sub.type, dir, brackets))
    return matchMarkedBrackets(state, pos, dir, sub, matches, brackets)
  else
    return matchPlainBrackets(state, pos, dir, tree, sub.type, maxScanDistance, brackets)
}

function matchMarkedBrackets(_state: EditorState, _pos: number, dir: -1 | 1, token: Subtree,
                             matching: readonly string[], brackets: string) {
  let parent = token.parent, firstToken = {from: token.start, to: token.end}
  let depth = 0
  return (parent && parent.iterate({
    from: dir < 0 ? token.start : token.end,
    to: dir < 0 ? parent.start : parent.end,
    enter(type, from, to) {
      if (dir < 0 ? to > token.start : from < token.end) return undefined
      if (depth == 0 && matching.indexOf(type.name) > -1) {
        return {start: firstToken, end: {from, to}, matched: true}
      } else if (matchingNodes(type, dir, brackets)) {
        depth++
      } else if (matchingNodes(type, -dir as -1 | 1, brackets)) {
        depth--
        if (depth == 0) return {start: firstToken, end: {from, to}, matched: false}
      }
      return false
    }
  })) || {start: firstToken, matched: false}
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

function toMatchingBracket(state: EditorState, dispatch: (tr: Transaction) => void, extend: boolean) {
  let found = false, selection = EditorSelection.create(state.selection.ranges.map(range => {
    let matching = matchBrackets(state, range.head, -1)
      || matchBrackets(state, range.head, 1)
      || (range.head > 0 && matchBrackets(state, range.head - 1, 1))
      || (range.head < state.doc.length && matchBrackets(state, range.head + 1, -1))
    if (!matching || !matching.end) return range
    found = true
    let head = matching.start.from == range.head ? matching.end.to : matching.end.from
    return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head)
  }), state.selection.primaryIndex)
  if (!found) return false
  dispatch(state.update({selection, scrollIntoView: true, annotations: Transaction.userEvent.of("keyboardselection")}))
  return true
}

/// Move the selection to the bracket matching the one it is currently
/// on, if any.
export const cursorMatchingBracket: StateCommand = ({state, dispatch}) => toMatchingBracket(state, dispatch, false)
/// Extend the selection to the bracket matching the one the selection
/// head is currently on, if any.
export const selectMatchingBracket: StateCommand = ({state, dispatch}) => toMatchingBracket(state, dispatch, true)
