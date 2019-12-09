export {EditorView, EditorConfig} from "./editorview"
export {Command, ViewPlugin, ViewUpdate} from "./extension"
export {Decoration, DecorationSet, WidgetType,
        MarkDecorationSpec, WidgetDecorationSpec, LineDecorationSpec, ReplaceDecorationSpec, BlockType} from "./decoration"
export {BlockInfo} from "./heightmap"
export {themeClass} from "./theme"
export {Range} from "../../rangeset"

import {HeightMap, HeightOracle, MeasuredHeights, QueryType} from "./heightmap"
/// @internal
export const __test = {HeightMap, HeightOracle, MeasuredHeights, QueryType}
