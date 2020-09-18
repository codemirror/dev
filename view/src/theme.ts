import {Facet} from "@codemirror/next/state"
import {StyleModule, StyleSpec} from "style-mod"

export const theme = Facet.define<string, string>({combine: strs => strs.join(" ")})

export const darkTheme = Facet.define<boolean, boolean>({combine: values => values.indexOf(true) > -1})

export const baseThemeID = StyleModule.newName()

function expandThemeClasses(sel: string) {
  return sel.replace(/\$\w[\w\.]*/g, cls => {
    let parts = cls.slice(1).split("."), result = ""
    for (let i = 1; i <= parts.length; i++) result += ".cm-" + parts.slice(0, i).join("-")
    return result
  })
}

export function buildTheme(mainID: string, spec: {[name: string]: StyleSpec}) {
  let scope = "." + mainID
  return new StyleModule(spec, {
    process(sel) {
      sel = expandThemeClasses(sel)
      let top = /^\s*\$/.exec(sel)
      return top ? scope + sel.slice(top[0].length) : scope + " " + sel
    },
    extend(template, sel) {
      template = expandThemeClasses(template)
      return sel.slice(0, scope.length + 1) == scope + " "
        ? scope + " " + template.replace(/&/, sel.slice(scope.length + 1))
        : template.replace(/&/, sel)
    }
  })
}

/// Create a set of CSS class names for the given theme class, which
/// can be added to a DOM element within an editor to make themes able
/// to style it. Theme classes can be single words or words separated
/// by dot characters. In the latter case, the returned classes
/// combine those that match the full name and those that match some
/// prefix—for example `"panel.search"` will match both the theme
/// styles specified as `"panel.search"` and those with just
/// `"panel"`. More specific theme classes (with more dots) take
/// precedence over less specific ones.
export function themeClass(selector: string): string {
  if (selector.indexOf(".") < 0) return "cm-" + selector
  let parts = selector.split("."), result = ""
  for (let i = 1; i <= parts.length; i++)
    result += (result ? " " : "") + "cm-" + parts.slice(0, i).join("-")
  return result
}    

export const baseTheme = buildTheme(baseThemeID, {
  $: {
    position: "relative !important",
    boxSizing: "border-box",
    "&$focused": {
      // FIXME it would be great if we could directly use the browser's
      // default focus outline, but it appears we can't, so this tries to
      // approximate that
      outline_fallback: "1px dotted #212121",
      outline: "5px auto -webkit-focus-ring-color"
    },
    display: "flex !important",
    flexDirection: "column"
  },

  $scroller: {
    display: "flex !important",
    alignItems: "flex-start !important",
    fontFamily: "monospace",
    lineHeight: 1.4,
    height: "100%",
    overflowX: "auto",
    position: "relative"
  },

  $content: {
    margin: 0,
    flexGrow: 2,
    minHeight: "100%",
    display: "block",
    whiteSpace: "pre",
    boxSizing: "border-box",

    padding: "4px 0",
    outline: "none"
  },

  "$$light $content": { caretColor: "black" },
  "$$dark $content": { caretColor: "white" },

  $line: {
    display: "block",
    padding: "0 2px 0 4px"
  },

  $button: {
    verticalAlign: "middle",
    color: "inherit",
    fontSize: "70%",
    padding: ".2em 1em",
    borderRadius: "3px"
  },

  "$$light $button": {
    backgroundImage: "linear-gradient(#eff1f5, #d9d9df)",
    border: "1px solid #888",
    "&:active": {
      backgroundImage: "linear-gradient(#b4b4b4, #d0d3d6)"
    }
  },

  "$$dark $button": {
    backgroundImage: "linear-gradient(#555, #111)",
    border: "1px solid #888",
    "&:active": {
      backgroundImage: "linear-gradient(#111, #333)"
    }
  },

  $textfield: {
    verticalAlign: "middle",
    color: "inherit",
    fontSize: "70%",
    border: "1px solid silver",
    padding: ".2em .5em"
  },

  "$$light $textfield": {
    backgroundColor: "white"
  },

  "$$dark $textfield": {
    border: "1px solid #555",
    backgroundColor: "inherit"
  },

  $secondarySelection: {
    backgroundColor_fallback: "#3297FD",
    color_fallback: "white !important",
    backgroundColor: "Highlight",
    color: "HighlightText !important"
  },

  $secondaryCursor: {
    display: "inline-block",
    verticalAlign: "text-top",
    width: 0,
    height: "1.15em",
    margin: "0 -0.7px -.7em"
  },

  "$$light $secondaryCursor": { borderLeft: "1.4px solid #555" },
  "$$dark $secondaryCursor": { borderLeft: "1.4px solid #ddd" }
})
