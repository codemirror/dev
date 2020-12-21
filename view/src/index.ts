export {EditorView, DOMEventMap, DOMEventHandlers} from "./editorview"
export {Command, ViewPlugin, PluginValue, PluginSpec, PluginFieldProvider, PluginField, ViewUpdate, logException} from "./extension"
export {Decoration, DecorationSet, WidgetType, BlockType} from "./decoration"
export {BlockInfo} from "./heightmap"
export {themeClass} from "./theme"
export {MouseSelectionStyle} from "./input"
export {BidiSpan, Direction} from "./bidi"
export {KeyBinding, keymap, runScopeHandlers} from "./keymap"
export {drawSelection} from "./draw-selection"
export {highlightSpecialChars} from "./special-chars"
export {placeholder} from "./placeholder"
export {Rect} from "./dom"
export {Range} from "@codemirror/next/rangeset"

import {HeightMap, HeightOracle, MeasuredHeights, QueryType} from "./heightmap"
import {ChangedRange} from "./extension"
import {computeOrder, moveVisually} from "./bidi"
/// @internal
export const __test = {HeightMap, HeightOracle, MeasuredHeights, QueryType, ChangedRange, computeOrder, moveVisually}
