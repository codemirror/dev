// FIXME move DocInput somewhere and document it
export {LezerSyntax, DocInput} from "./syntax"

export {TreeIndentContext, indentNodeProp,
        delimitedIndent, continuedIndent, flatIndent} from "./indent"

export {foldNodeProp} from "./fold"

import {ParseState} from "./syntax"

/// @internal
export const __test = {ParseState}
