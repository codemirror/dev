export {EditorView, EditorConfig} from "./editorview"
export {ViewCommand, ViewPlugin, ViewPluginValue, ViewUpdate} from "./extension"
export {Viewport} from "./viewport"
export {Decoration, DecorationSet, DecoratedRange, WidgetType,
        MarkDecorationSpec, WidgetDecorationSpec, LineDecorationSpec, ReplaceDecorationSpec, BlockType} from "./decoration"
export {BlockInfo} from "./heightmap"
export {Slot} from "../../extension"

import {HeightMap, HeightOracle, MeasuredHeights, QueryType} from "./heightmap"
/// @internal
export const __test = {HeightMap, HeightOracle, MeasuredHeights, QueryType}
