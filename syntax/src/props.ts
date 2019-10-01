import {NodeProp} from "lezer-tree"

function mkMatchProp() { return new NodeProp<string[]>({deserialize(str) { return str.split(" ") }}) }

/// A node prop that encodes information about which other nodes match
/// this node as delimiters. Should hold a space-separated list of
/// node names of the closing nodes that match this node.
export const openNodeProp = mkMatchProp()

/// Like `openNodeProp`, but for closing nodes. Should hold a
/// space-separated list of opening node names that match this closing
/// delimiter.
export const closeNodeProp = mkMatchProp()
