import {EditorView} from "@codemirror/next/view"
import {Extension} from "@codemirror/next/state"
import {highlighter} from "@codemirror/next/highlight"

export const oneDarkTheme = EditorView.theme({
  wrap: {
    color: "#abb2bf",
    backgroundColor: "#282c34",
    "& ::selection": {backgroundColor: "#405948"},
    caretColor: "#528bff"
  },

  secondaryCursor: {borderLeft: "1.4px solid #528bff"},
  secondarySelection: {backgroundColor: "#405948"},

  panels: {backgroundColor: "#282c34", color: "#abb2bf"},
  "panels.top": {borderBottom: "2px solid black"},
  "panels.bottom": {borderTop: "2px solid black"},

  searchMatch: {
    backgroundColor: "#42557b",
    border: "1px solid #457dff"
  },
  "searchMatch.selected": {
    backgroundColor: "#6199ff2f"
  },

  activeLine: {backgroundColor: "#2c313c"},
  selectionMatch: {backgroundColor: "#354139"},

  "matchingBracket, nonmatchingBracket": {backgroundColor: "#515a6b", border: "1px solid #515a6b"},

  gutters: {
    backgroundColor: "#282c34",
    color: "#495162",
    border: "none"
  },
  "gutterElement.lineNumber": {color: "#495162"},

  foldPlaceholder: {
    backgroundColor: "none",
    border: "none",
    color: "#ddd"
  },

  tooltip: {
    border: "1px solid #181a1f",
    backgroundColor: "#606862"
  },
  "tooltip.autocomplete": {
    "& > li[aria-selected]": {backgroundColor: "#282c34"}
  }
}, {dark: true})

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
  whiskey = "#d19a66"

export const oneDarkHighlighter = highlighter({
  invalid: {color: invalid},
  comment: {color: lightDark},
  keyword: {color: purple},
  "name, deleted": {color: coral},
  "operator, operatorKeyword, regexp": {color: fountainBlue},
  "string, inserted": {color: green},
  propertyName: {color: malibu},
  "color, name constant, name standard": {color: whiskey},
  "name definition": {color: lightWhite},
  "typeName, className, number, changed": {color: chalky},
  "meta": {color: dark},
  strong: {fontWeight: "bold"},
  emphasis: {fontStyle: "italic"},
  link: {color: dark, textDecoration: "underline"},
  heading: {fontWeight: "bold", color: coral}
})

export const oneDark: Extension = [oneDarkTheme, oneDarkHighlighter]
