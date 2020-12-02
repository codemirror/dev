import {EditorView} from "@codemirror/next/view"
import {Extension} from "@codemirror/next/state"
import {highlightStyle, tags as t} from "@codemirror/next/highlight"

const chalky = "#e5c07b",
  coral = "#e06c75",
  dark = "#5c6370",
  fountainBlue = "#56b6c2",
  green = "#98c379",
  invalid = "#ffffff",
  lightDark = "#7f848e",
  lightWhite = "#abb2bf",
  malibu = "#61afef",
  purple = "#c678dd",
  whiskey = "#d19a66",
  background = "#282c34",
  selection = "#405948",
  cursor = "#528bff"

const oneDarkTheme = EditorView.theme({
  $: {
    color: lightWhite,
    backgroundColor: background,
    "& ::selection": {backgroundColor: selection},
    caretColor: cursor
  },

  "$$focused $cursor": {borderLeftColor: cursor},
  "$$focused $selectionBackground": {backgroundColor: selection},

  $panels: {backgroundColor: background, color: lightWhite},
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

const oneDarkHighlighter = highlightStyle(
  {tag: t.comment,
   color: lightDark},
  {tag: t.keyword,
   color: purple},
  {tag: [t.name, t.deleted],
   color: coral},
  {tag: [t.operator, t.operatorKeyword, t.regexp],
   color: fountainBlue},
  {tag: [t.string, t.inserted],
   color: green},
  {tag: t.propertyName,
   color: malibu},
  {tag: [t.color, t.constant(t.name), t.standard(t.name)],
   color: whiskey},
  {tag: t.definition(t.name),
   color: lightWhite},
  {tag: [t.typeName, t.className, t.number, t.changed],
   color: chalky},
  {tag: t.meta,
   color: dark},
  {tag: t.strong,
   fontWeight: "bold"}, // FIXME export a template for this from highlight
  {tag: t.emphasis,
   fontStyle: "italic"},
  {tag: t.link,
   color: dark,
   textDecoration: "underline"},
  {tag: t.heading,
   fontWeight: "bold",
   color: coral},
  {tag: [t.atom, t.bool],
   color: whiskey },
  {tag: t.invalid,
   color: invalid},
)

/// Extension to enable the One Dark theme.
export const oneDark: Extension = [oneDarkTheme, oneDarkHighlighter]
