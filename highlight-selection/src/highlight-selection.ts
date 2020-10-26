import {EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, themeClass} from "@codemirror/next/view"
import {Facet, combineConfig, Text, CharCategory, Extension} from "@codemirror/next/state"
import {SearchCursor} from "@codemirror/next/search"

/// Mark lines that have a cursor on them with the \`$activeLine\`
/// theme class.
export function highlightActiveLine(): Extension {
  return [defaultTheme, activeLineHighlighter]
}

const lineDeco = Decoration.line({attributes: {class: themeClass("activeLine")}})

const activeLineHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.getDeco(view)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) this.decorations = this.getDeco(update.view)
  }

  getDeco(view: EditorView) {
    let lastLineStart = -1, deco = []
    for (let r of view.state.selection.ranges) {
      if (!r.empty) continue
      let line = view.visualLineAt(r.head)
      if (line.from > lastLineStart) {
        deco.push(lineDeco.range(line.from))
        lastLineStart = line.from
      }
    }
    return Decoration.set(deco)
  }
}, {
  decorations: v => v.decorations
})

type HighlightOptions = {
  /// Determines whether, when nothing is selected, the word around
  /// the cursor is matched instead. Defaults to false.
  highlightWordAroundCursor?: boolean,
  /// The minimum length of the selection before it is highlighted.
  /// Defaults to 1 (always highlight non-cursor selections).
  minSelectionLength?: number,
  /// The amount of matches (in the viewport) at which to disable
  /// highlighting. Defaults to 100.
  maxMatches?: number
}

const defaultHighlightOptions = {
  highlightWordAroundCursor: false,
  minSelectionLength: 1,
  maxMatches: 100
}

const highlightConfig = Facet.define<HighlightOptions, Required<HighlightOptions>>({
  combine(options: readonly HighlightOptions[]) {
    return combineConfig(options, defaultHighlightOptions, {
      highlightWordAroundCursor: (a, b) => a || b,
      minSelectionLength: Math.min,
      maxMatches: Math.min
    })
  }
})

/// This extension highlights text that matches the selection. It uses
/// the `$selectionMatch` theme class for the highlighting. When
/// `highlightWordAroundCursor` is enabled, the word at the cursor
/// itself will be highlighted with `selectionMatch.main`.
export function highlightSelectionMatches(options?: HighlightOptions): Extension {
  let ext = [defaultTheme, matchHighlighter]
  if (options) ext.push(highlightConfig.of(options))
  return ext
}

function wordAt(doc: Text, pos: number, check: (ch: string) => CharCategory) {
  let line = doc.lineAt(pos)
  let from = pos - line.from, to = pos - line.from
  while (from > 0) {
    let prev = line.findClusterBreak(from, false)
    if (check(line.slice(prev, from)) != CharCategory.Word) break
    from = prev
  }
  while (to < line.length) {
    let next = line.findClusterBreak(to, true)
    if (check(line.slice(to, next)) != CharCategory.Word) break
    to = next
  }
  return from == to ? null : line.slice(from, to)
}

const matchDeco = Decoration.mark({class: themeClass("selectionMatch")})
const mainMatchDeco = Decoration.mark({class: themeClass("selectionMatch.main")})

const matchHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.getDeco(view)
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged || update.viewportChanged) this.decorations = this.getDeco(update.view)
  }

  getDeco(view: EditorView) {
    let conf = view.state.facet(highlightConfig)
    let {state} = view, sel = state.selection
    if (sel.ranges.length > 1) return Decoration.none
    let range = sel.primary, query, check = null
    if (range.empty) {
      if (!conf.highlightWordAroundCursor) return Decoration.none
      check = state.charCategorizer(range.head)
      query = wordAt(state.doc, range.head, check)
      if (!query) return Decoration.none
    } else {
      let len = range.to - range.from
      if (len < conf.minSelectionLength || len > 200) return Decoration.none
      query = state.sliceDoc(range.from, range.to).trim()
      if (!query) return Decoration.none
    }
    let deco = []
    for (let part of view.visibleRanges) {
      let cursor = new SearchCursor(state.doc, query, part.from, part.to)
      while (!cursor.next().done) {
        let {from, to} = cursor.value
        if (!check || ((from == 0 || check(state.sliceDoc(from - 1, from)) != CharCategory.Word) &&
                       (to == state.doc.length || check(state.sliceDoc(to, to + 1)) != CharCategory.Word))) {
          if (check && from <= range.from && to >= range.to)
            deco.push(mainMatchDeco.range(from, to))
          else if (from >= range.to || to <= range.from)
            deco.push(matchDeco.range(from, to))
          if (deco.length > conf.maxMatches) return Decoration.none
        }
      }
    }
    return Decoration.set(deco)
  }
}, {
  decorations: v => v.decorations
})

const defaultTheme = EditorView.baseTheme({
  "$$light $activeLine": { backgroundColor: "#f3f9ff" },
  "$$dark $activeLine": { backgroundColor: "#223039" },
  "$selectionMatch": { backgroundColor: "#99ff7780" },
  "$searchMatch $selectionMatch": {backgroundColor: "transparent"}
})
