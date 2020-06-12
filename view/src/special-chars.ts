import {Decoration, DecorationSet, WidgetType} from "./decoration"
import {Range} from "@codemirror/next/rangeset"
import {ViewPlugin, ViewUpdate} from "./extension"
import {EditorView} from "./editorview"
import {combineConfig, Facet, Extension} from "@codemirror/next/state"
import {countColumn} from "@codemirror/next/text"
import {StyleModule} from "style-mod"

interface SpecialCharConfig {
  /// An optional function that renders the placeholder elements.
  render?: ((code: number, description: string | null, placeHolder: string) => HTMLElement) | null
  /// Regular expression that matches the special characters to
  /// highlight.
  specialChars?: RegExp
  /// Regular expression that can be used to add characters to the
  /// default set of characters to highlight.
  addSpecialChars?: RegExp | null
}

const Specials = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200c\u200e\u200f\u2028\u2029\ufeff\ufff9-\ufffc]/gu

const Names: {[key: number]: string} = {
  0: "null",
  7: "bell",
  8: "backspace",
  10: "newline",
  11: "vertical tab",
  13: "carriage return",
  27: "escape",
  8203: "zero width space",
  8204: "zero width non-joiner",
  8205: "zero width joiner",
  8206: "left-to-right mark",
  8207: "right-to-left mark",
  8232: "line separator",
  8233: "paragraph separator",
  65279: "zero width no-break space",
  65532: "object replacement"
}

let _supportsTabSize: null | boolean = null
function supportsTabSize() {
  if (_supportsTabSize == null && typeof document != "undefined" && document.body) {
    let styles = document.body.style as any
    _supportsTabSize = (styles.tabSize || styles.MozTabSize) != null
  }
  return _supportsTabSize || false
}

const specialCharConfig = Facet.define<SpecialCharConfig, Required<SpecialCharConfig> & {replaceTabs?: boolean}>({
  combine(configs) {
    // FIXME make configurations compose properly
    let config: Required<SpecialCharConfig> & {replaceTabs?: boolean} = combineConfig(configs, {
      render: null,
      specialChars: Specials,
      addSpecialChars: null
    })
    
    if (config.replaceTabs = !supportsTabSize())
      config.specialChars = new RegExp("\t|" + config.specialChars.source, "gu")

    if (config.addSpecialChars)
      config.specialChars = new RegExp(config.specialChars.source + "|" + config.addSpecialChars.source, "gu")

    return config
  }
})

/// Returns an extension that installs highlighting of special
/// characters.
export function highlightSpecialChars(
  /// Configuration options.
  config: SpecialCharConfig = {}
): Extension {
  let ext = [specialCharConfig.of(config), specialCharPlugin]
  if (!supportsTabSize()) ext.push(tabStyleExt)
  return ext
}

const specialCharPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none
  decorationCache: {[char: number]: Decoration} = Object.create(null)

  constructor(public view: EditorView) {
    this.recompute()
  }

  update(update: ViewUpdate) {
    let confChange = update.prevState.facet(specialCharConfig) != update.state.facet(specialCharConfig)
    if (confChange) this.decorationCache = Object.create(null)
    if (confChange || update.changes.length || update.viewportChanged) this.recompute()
  }

  recompute() {
    let decorations: Range<Decoration>[] = []
    for (let {from, to} of this.view.visibleRanges)
      this.getDecorationsFor(from, to, decorations)
    this.decorations = Decoration.set(decorations)
  }

  getDecorationsFor(from: number, to: number, target: Range<Decoration>[]) {
    let config = this.view.state.facet(specialCharConfig)

    let {doc} = this.view.state
    for (let pos = from, cursor = doc.iterRange(from, to), m; !cursor.next().done;) {
      if (!cursor.lineBreak) {
        while (m = config.specialChars.exec(cursor.value)) {
          let code = m[0].codePointAt ? m[0].codePointAt(0) : m[0].charCodeAt(0), deco
          if (code == null) continue
          if (code == 9) {
            let line = doc.lineAt(pos + m.index)
            let size = this.view.state.tabSize, col = countColumn(doc.sliceString(line.start, pos + m.index), 0, size)
            deco = Decoration.replace({widget: new TabWidget((size - (col % size)) * this.view.defaultCharacterWidth)})
          } else {
            deco = this.decorationCache[code] ||
              (this.decorationCache[code] = Decoration.replace({widget: new SpecialCharWidget(config, code)}))
          }
          target.push(deco.range(pos + m.index, pos + m.index + m[0].length))
        }
      }
      pos += cursor.value.length
    }
  }
}).decorations()

// Assigns placeholder characters from the Control Pictures block to
// ASCII control characters
function placeHolder(code: number): string | null {
  if (code >= 32) return null
  if (code == 10) return "\u2424"
  return String.fromCharCode(9216 + code)
}

const DefaultPlaceholder = "\u2022"

class SpecialCharWidget extends WidgetType<number> {
  constructor(private options: Required<SpecialCharConfig>, code: number) { super(code) }

  toDOM() {
    let ph = placeHolder(this.value) || DefaultPlaceholder
    let desc = "Control character " + (Names[this.value] || this.value)
    let custom = this.options.render && this.options.render(this.value, desc, ph)
    if (custom) return custom
    let span = document.createElement("span")
    span.textContent = ph
    span.title = desc
    span.setAttribute("aria-label", desc)
    span.style.color = "red"
    return span
  }

  ignoreEvent(): boolean { return false }
}

class TabWidget extends WidgetType<number> {
  toDOM() {
    let span = document.createElement("span")
    span.textContent = "\t"
    span.className = tabStyle.tab
    span.style.width = this.value + "px"
    return span
  }

  ignoreEvent(): boolean { return false }
}

const tabStyle = new StyleModule({
  tab: {
    display: "inline-block",
    overflow: "hidden",
    verticalAlign: "bottom"
  }
})
const tabStyleExt = EditorView.styleModule.of(tabStyle)
