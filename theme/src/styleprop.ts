import {NodeType, NodeProp, NodePropSource} from "lezer"

export const styleNodeProp = new class extends NodeProp<number> {
  styles(f: (type: NodeType) => StyleName | undefined): NodePropSource {
    return new NodePropSource(this, type => {
      let result = f(type)
      return typeof result == "object" ? result.__id : result
    })
  }
}

export type StyleName = {
  /// @internal
  __id: number
}

const none = {}
let nextID = 0

function s<T>(children: T = none as T): T & StyleName {
  let result = Object.create(null)
  result.__id = nextID++
  for (let prop in children) result[prop] = children[prop]
  return result
}
function ns() {
  return s({define: s(), builtin: s()})
}
function bs() {
  return s({open: s(), close: s()})
}

export const Style = {
  comment: s({line: s(), block: s()}),
  literal: s({
    regexp: s(),
    string: s({special: s()}),
    number: s({integer: s(), float: s(), special: s()}),
    character: s(),
    escape: s(),
    color: s() // FIXME
  }),
  invalid: s({illegal: s(), deprecated: s(), unexpected: s()}),
  keyword: s({
    expression: s({self: s(), null: s()}),
    operator: s(),
    unit: s(),
    modifier: s(),
    control: s(),
    define: s(),
    special: s()
  }),
  markup: s({
    content: s(),
    underline: s(),
    link: s(),
    strong: s(),
    emphasis: s(),
    heading: s(),
    list: s(),
    quote: s(),
    changed: s(),
    inserted: s(),
    deleted: s()
  }),
  meta: s({
    declaration: s(),
    annotation: s(),
    instruction: s()
  }),
  name: s({
    variable: ns(),
    type: ns(),
    constant: ns(),
    property: ns(),
    class: ns(),
    value: ns(),
    label: ns(),
    namespace: ns(),
    special: ns()
  }),
  punctuation: s({
    define: s(),
    separator: s(),
    modifier: s(),
    marker: s(),
    special: s()
  }),
  operator: s({
    deref: s(),
    arithmetic: s(),
    logic: s(),
    bitwise: s(),
    define: s(),
    compare: s(),
    update: s(),
    control: s()
  }),
  bracket: s({
    angle: bs(),
    square: bs(),
    paren: bs(),
    brace: bs(),
    special: bs()
  })
}

export const StyleNames: string[] = []

function walk(object: {[name: string]: any}, prefix: string) {
  if (prefix) StyleNames[object.__id] = prefix
  for (let prop in object) if (prop != "__id")
    walk(object[prop], prefix ? prefix + "." + prop : prop)
}
walk(Style, "")
