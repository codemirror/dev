import {EditorView} from "@codemirror/next/view"

export const baseTheme = EditorView.baseTheme({
  "tooltip.autocomplete": {
    fontFamily: "monospace",
    overflowY: "auto",
    maxHeight: "10em",
    listStyle: "none",
    margin: 0,
    padding: 0,

    "& > li": {
      cursor: "pointer",
      padding: "1px 1em 1px 3px",
      lineHeight: 1.2
    },

    "& > li[aria-selected]": {
      background_fallback: "#bdf",
      backgroundColor: "Highlight",
      color_fallback: "white",
      color: "HighlightText"
    }
  },

  "snippetField@light": {backgroundColor: "#ddd"},
  "snippetField@dark": {backgroundColor: "#333"},
  "snippetFieldPosition": {
    verticalAlign: "text-top",
    width: 0,
    height: "1.15em",
    margin: "0 -0.7px -.7em",
    borderLeft: "1.4px solid #888"
  }
})
