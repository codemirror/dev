import {NodeProp} from "lezer-tree"

function mkMatchProp() { return new NodeProp<string[]>({deserialize(str) { return str.split(" ") }}) }

export const openNodeProp = mkMatchProp(), closeNodeProp = mkMatchProp()
