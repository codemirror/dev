import {EditorState, Facet} from "@codemirror/next/state"
import {IndentContext} from "./indent"

/// A facet that registers a code folding service. When called with
/// the extent of a line, such a function should return a range
/// object when a foldable that starts on that line (but continues
/// beyond it), if one can be found.
export const foldable = Facet.define<(state: EditorState, lineStart: number, lineEnd: number) => ({from: number, to: number} | null)>()

/// Facet that defines a way to query for automatic indentation
/// depth at the start of a given line.
export const indentation = Facet.define<(context: IndentContext, pos: number) => number>()

/// Facet for overriding the unit by which indentation happens.
/// Should be a string consisting either entirely of spaces or
/// entirely of tabs. When not set, this defaults to 2 spaces.
export const indentUnit = Facet.define<string, string>({
  combine: values => {
    if (!values.length) return "  "
    if (!/^(?: +|\t+)$/.test(values[0])) throw new Error("Invalid indent unit: " + JSON.stringify(values[0]))
    return values[0]
  }
})
