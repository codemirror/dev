export {Language, syntaxTree} from "./language"

export {foldable, indentation, indentUnit} from "./facets"

export {IndentContext, getIndentUnit, indentString, indentOnInput,
        TreeIndentContext, indentNodeProp, delimitedIndent, continuedIndent, flatIndent} from "./indent"

export {foldNodeProp} from "./fold"

import {ParseState} from "./language"

/// @internal
export const __test = {ParseState}
