export {EditorView, EditorConfig} from "./editorview"
export {ViewCommand, ViewPlugin, DecorationPluginSpec, ViewPluginValue, ViewUpdate} from "./extension"
export {Decoration, DecorationSet, WidgetType,
        MarkDecorationSpec, WidgetDecorationSpec, LineDecorationSpec, ReplaceDecorationSpec, BlockType} from "./decoration"
export {BlockInfo} from "./heightmap"
export {Range} from "../../rangeset"

import {HeightMap, HeightOracle, MeasuredHeights, QueryType} from "./heightmap"
/// @internal
export const __test = {HeightMap, HeightOracle, MeasuredHeights, QueryType}
