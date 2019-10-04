import {NodeType, NodeProp} from "lezer-tree"
import {Style, StyleModule} from "style-mod"
import {EditorView, ViewPlugin, ViewPluginValue, ViewUpdate, Decoration, DecoratedRange} from "../../view"
import {Syntax, EditorState} from "../../state"

const Inherit = 1

/// A tag system defines a set of node (token) tags used for
/// highlighting. You'll usually want to use the
/// [default](#highlight.defaultTags) set, but it is possible to
/// define your own custom system when that doesn't fit your use case.
export class TagSystem {
  /// The flags argument given when creating this system.
  flags: readonly string[]

  /// The types argument given when creating this system.
  types: readonly string[]

  /// @internal
  flagMask: number
  /// @internal
  typeShift: number
  /// @internal
  typeNames: string[] = [""]
  /// @internal
  parents: number[]
  
  /// A [node
  /// prop](https://lezer.codemirror.net/docs/ref#tree.NodeProp) used
  /// to associate styling tag information with syntax tree nodes.
  prop = new NodeProp<number>()

  /// Define a tag system. Each tag identifies a type of syntactic
  /// element, which can have a single type and any number of flags.
  /// The `flags` argument should be an array of flag names, and the
  /// `types` argument an array of type names. Type names may have a
  /// `"name=parentName"` format to specify that this type is an
  /// instance of some other type, which means that, if no styling for
  /// the type itself is provided, it'll fall back to the parent
  /// type's styling.
  constructor(options: {flags: string[], types: string[]}) {
    this.flags = options.flags
    this.types = options.types
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

  /// Parse a tag name into a numeric ID. Only necessary if you are
  /// manually defining [node properties](#highlight.TagSystem.prop)
  /// for this system.
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

  /// Create a
  /// [`PropSource`](https://lezer.codemirror.net/docs/ref#tree.PropSource)
  /// that adds node properties for this system. `tags` should map
  /// node type
  /// [selectors](https://lezer.codemirror.net/docs/ref#tree.NodeType^match)
  /// to tag names.
  add(tags: {[selector: string]: string}) {
    let match = NodeType.match(tags)
    return this.prop.add((type: NodeType) => {
      let found = match(type)
      return found == null ? undefined : this.get(found)
    })
  }

  /// Create a highlighter extension for this system, styling the
  /// given tags using the given CSS objects.
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

/// The set of highlighting tags used by regular language packages and
/// themes. See [the guide](FIXME) for a list of the tags it defines.
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

/// Used to add a set of tags to a language syntax via
/// [`Parser.withProps`](https://lezer.codemirror.net/docs/ref#lezer.Parser.withProps).
/// The argument object can use syntax node selectors (see
/// [`NodeType.match`](https://lezer.codemirror.net/docs/ref#tree.NodeType^match))
/// as property names, and tag names (in the [default tag
/// system](#highlight.defaultTags)) as values.
export const styleTags = (tags: {[selector: string]: string}) => defaultTags.add(tags)

/// Create a highlighter theme that adds the given styles to the given
/// tags. The spec's property names must be tag names, and the values
/// [`style-mod`](https://github.com/marijnh/style-mod#documentation)
/// style objects that define the CSS for that tag.
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

/// A default highlighter (works well with light themes).
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
