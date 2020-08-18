import {EditorView} from "@codemirror/next/view"

export const baseTheme = EditorView.baseTheme({
  "tooltip.autocomplete": {
    fontFamily: "monospace",
    overflowY: "auto",
    whiteSpace: "nowrap",
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
    borderLeft: "1.4px dotted #888"
  },

  completionMatchedText: {
    textDecoration: "underline"
  },

  completionIcon: {
    fontSize: "90%",
    width: ".8em",
    display: "inline-block",
    textAlign: "center",
    paddingRight: ".6em",
    opacity: "0.6"
  },

  "completionIcon.function, completionIcon.method": {
    "&:after": { content: "'ƒ'" }
  },
  "completionIcon.class": {
    "&:after": { content: "'○'" }
  },
  "completionIcon.interface": {
    "&:after": { content: "'◌'" }
  },
  "completionIcon.variable": {
    "&:after": { content: "'𝑥'" }
  },
  "completionIcon.constant": {
    "&:after": { content: "'𝐶'" }
  },
  "completionIcon.type": {
    "&:after": { content: "'𝑡'" }
  },
  "completionIcon.enum": {
    "&:after": { content: "'∪'" }
  },
  "completionIcon.property": {
    "&:after": { content: "'□'" }
  },
  "completionIcon.keyword": {
    "&:after": { content: "'🔑\uFE0E'" } // Disable emoji rendering
  },
  "completionIcon.namespace": {
    "&:after": { content: "'▢'" }
  },
  "completionIcon.text": {
    "&:after": { content: "'abc'", fontSize: "50%", verticalAlign: "middle" }
  }
})
