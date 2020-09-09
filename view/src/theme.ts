import {Facet} from "@codemirror/next/state"
import {StyleModule, Style} from "style-mod"

export const theme = Facet.define<string, string>({combine: strs => strs.join(" ")})

export const darkTheme = Facet.define<boolean, boolean>({combine: values => values.indexOf(true) > -1})

export const baseThemeID = StyleModule.newName()
export const baseLightThemeID = StyleModule.newName()
export const baseDarkThemeID = StyleModule.newName()

export function buildTheme(mainID: string, spec: {[name: string]: Style}) {
  let styles = Object.create(null)
  for (let prop in spec) {
    let selector = prop.split(/\s*,\s*/).map(piece => {
      let id = mainID, narrow
      if (id == baseThemeID && (narrow = /^(.*?)@(light|dark)$/.exec(piece))) {
        id = narrow[2] == "dark" ? baseDarkThemeID : baseLightThemeID
        piece = narrow[1]
      }
      let parts = piece.split("."), selector = "." + id + (parts[0] == "wrap" ? "" : " /*|*/ ")
      for (let i = 1; i <= parts.length; i++) selector += ".cm-" + parts.slice(0, i).join("-")
      return selector
    }).join(", ")
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
    outline: "none"
  },

  "content@light": { caretColor: "black" },
  "content@dark": { caretColor: "white" },

  line: {
    display: "block",
    padding: "0 2px 0 4px"
  },

  button: {
    verticalAlign: "middle",
    color: "inherit",
    fontSize: "70%",
    padding: ".2em 1em",
    borderRadius: "3px"
  },

  "button@light": {
    backgroundImage: "linear-gradient(#eff1f5, #d9d9df)",
    border: "1px solid #888",
    "&:active": {
      backgroundImage: "linear-gradient(#b4b4b4, #d0d3d6)"
    }
  },

  "button@dark": {
    backgroundImage: "linear-gradient(#555, #111)",
    border: "1px solid #888",
    "&:active": {
      backgroundImage: "linear-gradient(#111, #333)"
    }
  },

  textfield: {
    verticalAlign: "middle",
    color: "inherit",
    fontSize: "70%",
    border: "1px solid silver",
    padding: ".2em .5em"
  },

  "textfield@light": {
    backgroundColor: "white"
  },

  "textfield@dark": {
    border: "1px solid #555",
    backgroundColor: "inherit"
  },

  secondarySelection: {
    backgroundColor_fallback: "#3297FD",
    color_fallback: "white !important",
    backgroundColor: "Highlight",
    color: "HighlightText !important"
  },

  secondaryCursor: {
    display: "inline-block",
    verticalAlign: "text-top",
    width: 0,
    height: "1.15em",
    margin: "0 -0.7px -.7em"
  },

  "secondaryCursor@light": { borderLeft: "1.4px solid #555" },
  "secondaryCursor@dark": { borderLeft: "1.4px solid #ddd" }
})
