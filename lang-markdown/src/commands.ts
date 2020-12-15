import {StateCommand, Text, EditorSelection, ChangeSpec} from "@codemirror/next/state"
import {syntaxTree} from "@codemirror/next/language"
import {SyntaxNode} from "lezer-tree"
import {markdownLanguage} from "./markdown"

function nodeStart(node: SyntaxNode, doc: Text) {
  let line = doc.lineAt(node.from), off = node.from - line.from
  return line.slice(off, off + 100)
}

function gatherMarkup(node: SyntaxNode, line: string, doc: Text) {
  let nodes = []
  for (let cur: SyntaxNode | null = node; cur && cur.name != "Document"; cur = cur.parent) {
    if (cur.name == "ListItem" || cur.name == "Blockquote")
      nodes.push(cur)
  }
  let markup = [], pos = 0
  for (let i = nodes.length - 1; i >= 0; i--) {
    let node = nodes[i], match
    if (node.name == "Blockquote" && (match = /^\s*> ?/.exec(line.slice(pos)))) {
      markup.push({from: pos, string: match[0], node})
      pos += match[0].length
    } else if (node.name == "ListItem" && node.parent!.name == "OrderedList" &&
               (match = /^\s*\d+([.)])\s*/.exec(nodeStart(node, doc)))) {
      let len = match[1].length >= 4 ? match[0].length - match[1].length + 1 : match[0].length
      markup.push({from: pos, string: line.slice(pos, pos + len).replace(/\S/g, " "), node})
      pos += len
    } else if (node.name == "ListItem" && node.parent!.name == "BulletList" &&
               (match = /^\s*[-+*] (\s*)/.exec(nodeStart(node, doc)))) {
      let len = match[1].length >= 4 ? match[0].length - match[1].length : match[0].length
      markup.push({from: pos, string: line.slice(pos, pos + len).replace(/\S/g, " "), node})
      pos += len
    }
  }
  return markup
}

function renumberList(after: SyntaxNode, doc: Text, changes: ChangeSpec[]) {
  for (let prev = -1, node = after;;) {
    if (node.name == "ListItem") {
      let m = /^(\s*)(\d+)(?=[.)])/.exec(doc.sliceString(node.from, node.from + 10))
      if (!m) return
      let number = +m[2]
      if (prev >= 0) {
        if (number != prev + 1) return
        changes.push({from: node.from + m[1].length, to: node.from + m[0].length, insert: String(prev + 2)})
      }
      prev = number
    }
    let next = node.nextSibling
    if (!next) break
    node = next
  }
}

/// This command, when invoked in Markdown context with cursor
/// selection(s), will create a new line with the markup for
/// blockquotes and lists that were active on the old line. If the
/// cursor was directly after the end of the markup for the old line,
/// trailing whitespace and list markers are removed from that line.
///
/// The command does nothing in non-Markdown context, so it should
/// not be used as the only binding for Enter (even in a Markdown
/// document, HTML and code regions might use a different language).
export const insertNewlineContinueMarkup: StateCommand = ({state, dispatch}) => {
  let tree = syntaxTree(state)
  let dont = null, changes = state.changeByRange(range => {
    if (range.empty && markdownLanguage.isActiveAt(state, range.from)) {
      let line = state.doc.lineAt(range.from), lineText = line.slice(0, 100)
      let markup = gatherMarkup(tree.resolve(range.from, -1), lineText, state.doc)
      let from = range.from, changes: ChangeSpec[] = []
      if (markup.length) {
        let inner = markup[markup.length - 1], innerEnd = inner.from + inner.string.length
        if (range.from - line.from >= innerEnd && !/\S/.test(lineText.slice(innerEnd, range.from - line.from))) {
          let start = /List/.test(inner.node.name) ? inner.from : innerEnd
          while (start > 0 && /\s/.test(lineText[start - 1])) start--
          from = line.from + start
        }
        if (inner.node.name == "ListItem") {
          if (from < range.from && inner.node.parent!.from == inner.node.from) { // First item
            inner.string = ""
          } else {
            inner.string = lineText.slice(inner.from, inner.from + inner.string.length)
            if (inner.node.parent!.name == "OrderedList" && from == range.from) {
              inner.string = inner.string.replace(/\d+/, m => (+m + 1) as any)
              renumberList(inner.node, state.doc, changes)
            }
          }
        }
      }
      let insert = markup.map(m => m.string).join("")
      changes.push({from, to: range.from, insert: Text.of(["", insert])})
      return {range: EditorSelection.cursor(from + 1 + insert.length), changes}
    }
    return dont = {range}
  })
  if (dont) return false
  dispatch(state.update(changes, {scrollIntoView: true}))
  return true
}

/// This command will, when invoked in a Markdown context with the
/// cursor directly after list or blockquote markup, delete one level
/// of markup. When the markup is for a list, it will be replaced by
/// spaces on the first invocation (a further invocation will delete
/// the spaces), to make it easy to continue a list.
///
/// When not after Markdown block markup, this command will return
/// false, so it is intended to be bound alongside other deletion
/// commands, with a higher precedence than the more generic commands.
export const deleteMarkupBackward: StateCommand = ({state, dispatch}) => {
  let tree = syntaxTree(state)
  let dont = null, changes = state.changeByRange(range => {
    if (range.empty && markdownLanguage.isActiveAt(state, range.from)) {
      let line = state.doc.lineAt(range.from), lineText = line.slice(0, 100)
      let markup = gatherMarkup(tree.resolve(range.from, -1), lineText, state.doc)
      if (markup.length) {
        let inner = markup[markup.length - 1], innerEnd = inner.from + inner.string.length
        if (range.from > innerEnd + line.from && !/\S/.test(lineText.slice(innerEnd, range.from - line.from)))
          return {range: EditorSelection.cursor(innerEnd + line.from),
                  changes: {from: innerEnd + line.from, to: range.from}}
        if (range.from - line.from == innerEnd) {
          let start = line.from + inner.from
          if (inner.node.name == "ListItem" && inner.node.parent!.from < inner.node.from &&
              /\S/.test(lineText.slice(inner.from, innerEnd)))
            return {range, changes: {from: start, to: start + inner.string.length, insert: inner.string}}
          return {range: EditorSelection.cursor(start), changes: {from: start, to: range.from}}
        }
      }
    }
    return dont = {range}
  })
  if (dont) return false
  dispatch(state.update(changes, {scrollIntoView: true}))
  return true
}
