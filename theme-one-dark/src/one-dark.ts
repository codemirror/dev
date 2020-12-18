import {EditorView} from "@codemirror/next/view"
import {Extension} from "@codemirror/next/state"
import {HighlightStyle, tags as t} from "@codemirror/next/highlight"

const chalky = "#e5c07b",
  coral = "#e06c75",
  cyan = "#56b6c2",
  invalid = "#ffffff",
  ivory = "#abb2bf",
  stone = "#5c6370",
  malibu = "#61afef",
  sage = "#98c379",
  whiskey = "#d19a66",
  violet = "#c678dd",
  background = "#282c34",
  selection = "#405948",
  cursor = "#528bff"

/// The editor theme styles for One Dark.
export const oneDarkTheme = EditorView.theme({
  $: {
    color: ivory,
    backgroundColor: background,
    "& ::selection": {backgroundColor: selection},
    caretColor: cursor
  },

  "$$focused $cursor": {borderLeftColor: cursor},
  "$$focused $selectionBackground": {backgroundColor: selection},

  $panels: {backgroundColor: background, color: ivory},
  "$panels.top": {borderBottom: "2px solid black"},
  "$panels.bottom": {borderTop: "2px solid black"},

  $searchMatch: {
    backgroundColor: "#72a1ff59",
    outline: "1px solid #457dff"
  },
  "$searchMatch.selected": {
    backgroundColor: "#6199ff2f"
  },

  $activeLine: {backgroundColor: "#2c313c"},
  $selectionMatch: {backgroundColor: "#aafe661a"},

  "$matchingBracket, $nonmatchingBracket": {
    backgroundColor: "#bad0f847",
    outline: "1px solid #515a6b"
  },

  $gutters: {
    backgroundColor: background,
    color: "#545868",
    border: "none"
  },
  "$gutterElement.lineNumber": {color: "inherit"},

  $foldPlaceholder: {
    backgroundColor: "none",
    border: "none",
    color: "#ddd"
  },

  $tooltip: {
    border: "1px solid #181a1f",
    backgroundColor: "#606862"
  },
  "$tooltip.autocomplete": {
    "& > ul > li[aria-selected]": {backgroundColor: background}
  }
}, {dark: true})

/// The highlighting style for code in the One Dark theme.
export const oneDarkHighlightStyle = HighlightStyle.define(
  {tag: t.keyword,
   color: violet},
  {tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
   color: coral},
  {tag: [t.processingInstruction, t.string, t.inserted],
   color: sage},
  {tag: [t.function(t.variableName), t.labelName],
   color: malibu},
  {tag: [t.color, t.constant(t.name), t.standard(t.name)],
   color: whiskey},
  {tag: [t.definition(t.name), t.separator],
   color: ivory},
  {tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
   color: chalky},
  {tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
   color: cyan},
  {tag: [t.meta, t.comment],
   color: stone},
  {tag: t.strong,
   fontWeight: "bold"},
  {tag: t.emphasis,
   fontStyle: "italic"},
  {tag: t.link,
   color: stone,
   textDecoration: "underline"},
  {tag: t.heading,
   fontWeight: "bold",
   color: coral},
  {tag: [t.atom, t.bool, t.special(t.variableName)],
   color: whiskey },
  {tag: t.invalid,
   color: invalid},
)

/// Extension to enable the One Dark theme (both the editor theme and
/// the highlight style).
export const oneDark: Extension = [oneDarkTheme, oneDarkHighlightStyle]
