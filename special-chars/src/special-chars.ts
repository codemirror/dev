import {Decoration, DecorationSet, Range, WidgetType, ViewPlugin, ViewUpdate, EditorView} from "../../view"
import {combineConfig, ChangedRange, Facet, Extension} from "../../state"
import {countColumn} from "../../text"
import {StyleModule} from "style-mod"

/// Configure the special character highlighter.
export interface SpecialCharConfig {
  /// An optional function that renders the placeholder elements.
  render?: ((code: number, description: string | null, placeHolder: string) => HTMLElement) | null
  /// Regular expression that matches the special characters to
  /// highlight.
  specialChars?: RegExp
  /// Regular expression that can be used to add characters to the
  /// default set of characters to highlight.
  addSpecialChars?: RegExp | null
}

const Specials = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff\ufff9-\ufffc]/gu

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

const specialCharConfig = Facet.define<SpecialCharConfig, Required<SpecialCharConfig> & {replaceTabs?: boolean}>({
  combine(configs) {
    // FIXME make configurations compose properly
    let config: Required<SpecialCharConfig> & {replaceTabs?: boolean} = combineConfig(configs, {
      render: null,
      specialChars: Specials,
      addSpecialChars: null
    })

    let styles = document.body.style as any
    config.replaceTabs = (styles.tabSize || styles.MozTabSize) == null
    if (config.replaceTabs)
      config.specialChars = new RegExp("\t|" + config.specialChars.source, "gu")

    if (config.addSpecialChars)
      config.specialChars = new RegExp(config.specialChars.source + "|" + config.addSpecialChars.source, "gu")

    return config
  }
})

/// Returns an extension that installs highlighting of special
/// characters.
export function specialChars(config: SpecialCharConfig = {}): Extension {
  return [specialCharConfig.of(config), specialCharPlugin, styleExt]
}

const JoinGap = 10

const specialCharPlugin = ViewPlugin.fromClass(class {
  from = 0
  to = 0
  decorations: DecorationSet = Decoration.none
  decorationCache: {[char: number]: Decoration} = Object.create(null)

  constructor(public view: EditorView) {
    this.updateForViewport()
  }

  update(update: ViewUpdate) {
    if (update.prevState.facet(specialCharConfig) != update.state.facet(specialCharConfig)) {
      this.decorationCache = Object.create(null)
      this.from = this.to = 0
      this.decorations = Decoration.none
    }
    if (update.changes.length) {
      this.decorations = this.decorations.map(update.changes)
      this.from = update.changes.mapPos(this.from, -1)
      this.to = update.changes.mapPos(this.to, 1)
      this.closeHoles(update.changes.changedRanges())
    }
    this.updateForViewport()
  }

  closeHoles(ranges: readonly ChangedRange[]) {
    let decorations: Range<Decoration>[] = [], vp = this.view.viewport, replaced: number[] = []
    let config = this.view.state.facet(specialCharConfig)
    for (let i = 0; i < ranges.length; i++) {
      let {fromB: from, toB: to} = ranges[i]
      // Must redraw all tabs further on the line
      if (config.replaceTabs) to = this.view.state.doc.lineAt(to).end
      while (i < ranges.length - 1 && ranges[i + 1].fromB < to + JoinGap) to = Math.max(to, ranges[++i].toB)
      // Clip to current viewport, to avoid doing work for invisible text
      from = Math.max(vp.from, from); to = Math.min(vp.to, to)
      if (from >= to) continue
      this.getDecorationsFor(from, to, decorations)
      replaced.push(from, to)
    }
    if (replaced.length) this.decorations = this.decorations.update({
      add: decorations,
      filter: pos => {
        for (let i = 0; i < replaced.length; i += 2)
          if (pos >= replaced[i] && pos < replaced[i + 1]) return false
        return true
      },
      filterFrom: replaced[0],
      filterTo: replaced[replaced.length - 1]
    })
  }

  updateForViewport() {
    let vp = this.view.viewport
    // Viewports match, don't do anything
    if (this.from == vp.from && this.to == vp.to) return
    let decorations: Range<Decoration>[] = []
    if (this.from >= vp.to || this.to <= vp.from) {
      this.getDecorationsFor(vp.from, vp.to, decorations)
      this.decorations = Decoration.set(decorations)
    } else {
      if (vp.from < this.from) this.getDecorationsFor(vp.from, this.from, decorations)
      if (this.to < vp.to) this.getDecorationsFor(this.to, vp.to, decorations)
      this.decorations = this.decorations.update({
        add: decorations,
        filter: (from, to) => from >= vp.from && to <= vp.to
      })
    }
    this.from = vp.from; this.to = vp.to
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
            let size = this.view.state.tabSize, col = countColumn(doc.slice(line.start, pos + m.index), 0, size)
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
    span.className = style.tab
    span.style.width = this.value + "px"
    return span
  }

  ignoreEvent(): boolean { return false }
}

const style = new StyleModule({
  tab: {
    display: "inline-block",
    overflow: "hidden",
    verticalAlign: "bottom"
  }
})
const styleExt = EditorView.styleModule.of(style)
