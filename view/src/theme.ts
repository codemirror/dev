import {Facet} from "@codemirror/next/state"
import {StyleModule, Style} from "style-mod"

export const theme = Facet.define<string>()

export const baseThemeID = StyleModule.newName()

export function buildTheme(id: string, spec: {[name: string]: Style}) {
  let styles = Object.create(null)
  for (let prop in spec) {
    let parts = prop.split("."), selector = "." + id + (parts[0] == "wrap" ? "" : " ")
    for (let i = 1; i <= parts.length; i++) selector += ".cm-" + parts.slice(0, i).join("-")
    styles[selector] = spec[prop]
  }
  return new StyleModule(styles, {generateClasses: false})
}

/// Create a set of CSS class names for the given theme selector,
/// which can be added to a DOM element within an editor to make
/// themes able to style it. Theme selectors can be single words or
/// words separated by dot characters. In the latter case, the
/// returned classes combine those that match the full name and those
/// that match some prefix—for example `"panel.search"` will match
/// both the theme styles specified as `"panel.search"` and those with
/// just `"panel"`. More specific theme styles (with more dots) take
/// precedence.
export function themeClass(selector: string): string {
  let parts = selector.split("."), result = ""
  for (let i = 1; i <= parts.length; i++)
    result += (result ? " " : "") + "cm-" + parts.slice(0, i).join("-")
  return result
}    

export const baseTheme = buildTheme(baseThemeID, {
  wrap: {
    position: "relative !important",
    boxSizing: "border-box",
    "&.cm-focused": {
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
    height: "100%",
    overflowX: "auto"
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
