import {StyleModule} from "style-mod"

export const styles = new StyleModule({
  wrapper: {
    position: "relative !important",
    boxSizing: "border-box",
    "&.codemirror-focused": {
      // FIXME it would be great if we could directly use the browser's
      // default focus outline, but it appears we can't, so this tries to
      // approximate that
      outline_fallback: "1px dotted #212121",
      outline: "5px auto -webkit-focus-ring-color"
    },
    display: "flex !important",
    flexDirection: "column"
  },

  scroller: {
    display: "flex !important",
    alignItems: "flex-start !important",
    fontFamily: "monospace",
    lineHeight: 1.4,
    height: "100%"
  },

  content: {
    margin: 0,
    flexGrow: 2,
    minHeight: "100%",
    display: "block",
    whiteSpace: "pre",
    boxSizing: "border-box",

    padding: "4px 0",
    outline: "none",
    caretColor: "black",
  },

  line: {
    display: "block",
    padding: "0 2px 0 4px"
  }
})
