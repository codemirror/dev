import {theme} from "./extension"
import {EditorState} from "../../state"
import {StyleModule} from "style-mod"

const themeCache: WeakMap<readonly StyleModule<{[key: string]: string}>[], {[selector: string]: string}>
  = typeof WeakMap == "undefined" ? fakeMap() : new WeakMap

function fakeMap() {
  let keys: any[] = [], values: any[] = [], next = 0, size = 5
  return {
    get(key: any) {
      let found = keys.indexOf(key)
      return found < 0 ? undefined : values[found]
    },
    set(key: any, value: any) {
      let index = next++ % size
      keys[index] = key
      values[index] = value
    }
  } as WeakMap<any, any>
}

/// Query the active themes for the CSS class names associated with
/// the given name. Names can be single words or words separated by
/// dot characters. In the latter case, the returned classes combine
/// those that match the full name and those that match some
/// prefix—for example `cssClass("panel.search")` will match both
/// the theme styles specified as `"panel.search"` and those with
/// just `"panel"`. More specific theme styles (with more dots) take
/// precedence.
export function themeClass(state: EditorState, selector: string): string {
  let themes = state.facet(theme)
  let cache = themeCache.get(themes)! // (`!` works around TS not narrowing for the block below)
  if (!cache) {
    cache = Object.create(null)
    themeCache.set(themes, cache)
  }

  let found = cache[selector]
  if (found != null) return found

  let result = ""
  for (let pos = 0;;) {
    let dot = selector.indexOf(".", pos)
    let cls = dot < 0 ? selector : selector.slice(0, dot)
    result += (result ? " " : "") + "codemirror-" + (pos ? cls.replace(/\./g, "-") : cls)
    for (let theme of themes) {
      let has = theme[cls]
      if (has) result += " " + has
    }
    if (dot < 0) break
    pos = dot + 1
  }
  return cache[selector] = result
}
