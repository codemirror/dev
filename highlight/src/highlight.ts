import {NodeType, NodeProp} from "lezer-tree"
import {Style, StyleModule} from "style-mod"
import {EditorView, ViewPlugin, ViewPluginValue, ViewUpdate, Decoration, DecoratedRange} from "../../view"
import {Syntax, EditorState} from "../../state"

const Inherit = 1

export class TagSystem {
  flags: readonly string[]
  flagMask: number
  typeShift: number
  typeNames: string[] = [""]
  parents: number[]
  
  /// A [node
  /// prop](https://lezer.codemirror.net/docs/ref#tree.NodeProp) used
  /// to associate styling tag information with syntax tree nodes.
  prop = new NodeProp<number>()

  constructor(options: {flags: string[], types: string[]}) {
    this.flags = options.flags
    this.flagMask = Math.pow(2, this.flags.length) - 1
    this.typeShift = this.flags.length + 1
    let parentNames: (string | undefined)[] = [undefined]
    for (let type of options.types) {
      let match = /^([\w\-]+)(?:=([\w-]+))?$/.exec(type)
      if (!match) throw new RangeError("Invalid type name " + type)
      this.typeNames.push(match[1])
      parentNames.push(match[2])
    }
    this.parents = parentNames.map(name => {
      if (name == null) return 0
      let id = this.typeNames.indexOf(name)
      if (id < 0) throw new RangeError(`Unknown parent type '${name}' specified`)
      return id
    })
    if (this.flags.length > 29 || this.typeNames.length > Math.pow(2, 29 - this.flags.length))
      throw new RangeError("Too many style tag flags to fit in a 30-bit integer")
  }

  get(name: string) {
    let value = name.charCodeAt(0) == 43 ? 1 : 0 // Check for leading '+'
    for (let part of (value ? name.slice(1) : name).split(" ")) if (part) {
      let flag = this.flags.indexOf(part)
      if (flag > -1) {
        value += 1 << (flag + 1)
      } else {
        let typeID = this.typeNames.indexOf(part)
        if (typeID < 0) throw new RangeError(`Unknown tag type '${part}'`)
        if (value >> this.typeShift) throw new RangeError(`Multiple tag types specified in '${name}'`)
        value += typeID << this.typeShift
      }
    }
    return value
  }

  add(tags: {[selector: string]: string}) {
    let match = NodeType.match(tags)
    return this.prop.add((type: NodeType) => {
      let found = match(type)
      return found == null ? undefined : this.get(found)
    })
  }

  highlighter(spec: {[tag: string]: Style}) {
    let styling = new Styling(this, spec)
    let plugin = new ViewPlugin(view => new Highlighter(view, this.prop, styling),
                                [ViewPlugin.behavior(EditorView.decorations, (h: Highlighter) => h.decorations)])
    return [plugin.extension, EditorView.styleModule(styling.module)]
  }

  /// @internal
  specificity(tag: number) {
    let flags = tag & this.flagMask, spec = 0
    for (let i = 1; i <= this.flags.length; i++)
      if (flags & (1 << i)) spec++
    for (let type = tag >> (this.flags.length + 1); type; type = this.parents[type]) spec += 1000
    return spec
  }
}

export const defaultTags = new TagSystem({
  flags: ["invalid", "meta", "type2", "type3", "type4",
          "link", "strong", "emphasis", "heading", "list", "quote",
          "changed", "inserted", "deleted",
          "definition", "meta", "constant", "control"],
  types: [
    "comment",
    "lineComment=comment",
    "blockComment=comment",
    "name",
    "variableName=name",
    "typeName=name",
    "propertyName=name",
    "className=name",
    "labelName=name",
    "namespace=name",
    "regexp",
    "string",
    "number",
    "integer=number",
    "float=number",
    "character=string",
    "escape",
    "color",
    "content",
    "keyword",
    "self=keyword",
    "null=keyword",
    "atom=keyword",
    "unit=keyword",
    "modifier=keyword",
    "operatorKeyword=keyword",
    "operator",
    "derefOperator=operator",
    "arithmeticOperator=operator",
    "logicOperator=operator",
    "bitwiseOperator=operator",
    "compareOperator=operator",
    "updateOperator=operator",
    "punctuation",
    "separator=punctuation",
    "bracket=punctuation",
    "angleBracket=bracket",
    "squareBracket=bracket",
    "paren=bracket",
    "brace=bracket"
  ]
})

export const styleTags = (tags: {[selector: string]: string}) => defaultTags.add(tags)

export const highlighter = (spec: {[tag: string]: Style}) => defaultTags.highlighter(spec)

class StyleRule {
  constructor(public type: number, public flags: number, public specificity: number, public cls: string) {}
}

class Styling {
  module: StyleModule<{[name: string]: string}>
  rules: readonly StyleRule[]
  cache: {[tag: number]: string} = Object.create(null)

  constructor(private tags: TagSystem, spec: {[name: string]: Style}) {
    let modSpec = Object.create(null)
    let nextCls = 0
    let rules: StyleRule[] = []
    for (let prop in spec) {
      let tag = tags.get(prop)
      let cls = "c" + nextCls++
      modSpec[cls] = spec[prop]
      rules.push(new StyleRule(tag >> tags.typeShift, tag & tags.flagMask, tags.specificity(tag), cls))
    }
    this.rules = rules.sort((a, b) => b.specificity - a.specificity)
    this.module = new StyleModule(modSpec)
  }

  match(tag: number) {
    let known = this.cache[tag]
    if (known != null) return known
    let result = ""
    let type = tag >> this.tags.typeShift, flags = tag & this.tags.flagMask
    for (;;) {
      for (let rule of this.rules) {
        if (rule.type == type && (rule.flags & flags) == rule.flags) {
          if (result) result += " "
          result += this.module[rule.cls]
          flags &= ~rule.flags
          if (type) break
        }
      }
      if (type) type = this.tags.parents[type]
      else break
    }
    return this.cache[tag] = result
  }
}

class Highlighter implements ViewPluginValue {
  partialDeco = false
  readonly syntax: Syntax | null = null
  decorations = Decoration.none

  constructor(view: EditorView, private prop: NodeProp<number>, private styling: Styling) {
    for (let s of view.state.behavior(EditorState.syntax)) {
      this.syntax = s
      break
    }
    this.buildDeco(view)
  }

  update(update: ViewUpdate) {
    if (this.partialDeco || update.docChanged || update.viewportChanged)
      this.buildDeco(update.view)
  }

  buildDeco(view: EditorView) {
    if (!this.syntax) return

    let {from, to} = view.viewport
    let {tree, rest} = this.syntax.getTree(view.state, from, to)
    this.partialDeco = !rest
    if (rest) view.waitFor(rest)

    let tokens: DecoratedRange[] = []
    let start = from
    function flush(pos: number, style: string) {
      if (pos > start && style)
        tokens.push(Decoration.mark(start, pos, {class: style}))
      start = pos
    }

    // The current node's own classes
    let curClass = ""
    let context: string[] = []
    let inherited: string[] = []
    tree.iterate({
      from, to,
      enter: (type, start) => {
        let inheritedClass = inherited.length ? inherited[inherited.length - 1] : ""
        let cls = inheritedClass
        let style = type.prop(this.prop)
        if (style != null) {
          let val = this.styling.match(style)
          if (val) {
            if (cls) cls += " "
            cls += val
          }
          if (style & Inherit) inheritedClass = cls
        }
        context.push(cls)
        if (inheritedClass) inherited.push(inheritedClass)
        if (cls != curClass) {
          flush(start, curClass)
          curClass = cls
        }
      },
      leave: (_t, _s, end) => {
        context.pop()
        inherited.pop()
        let backTo = context.length ? context[context.length - 1] : ""
        if (backTo != curClass) {
          flush(Math.min(to, end), curClass)
          curClass = backTo
        }
      }
    })
    this.decorations = Decoration.set(tokens)
  }
}

export const defaultHighlighter = highlighter({
  invalid: {color: "#f00"},
  keyword: {color: "#708"},
  atom: {color: "#219"},
  number: {color: "#164"},
  string: {color: "#a11"},
  character: {color: "#a11"},
  regexp: {color: "#e40"},
  escape: {color: "#e40"},
  "variableName definition": {color: "#00f"},
  typeName: {color: "#085"},
  "propertyName definition": {color: "#00c"},
  comment: {color: "#940"},
  meta: {color: "#555"}
})
