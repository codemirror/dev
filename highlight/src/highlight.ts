import {Tree, NodeType, NodeProp} from "lezer-tree"
import {Style, StyleModule} from "style-mod"
import {EditorView, ViewPlugin, ViewUpdate, Decoration, Range} from "../../view"
import {EditorState} from "../../state"

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
  typeIDs: {[name: string]: number} = Object.create(null)
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
  ///
  /// You can specify a `subtypes` property to assign a given number
  /// of sub-types to each type. These are automatically generated
  /// types with the base type name suffixed with `#1` to `#`_`N`_
  /// (where _N_ is the number given in the `subtypes` field) that
  /// have the base type as parent type.
  constructor(options: {flags: string[], types: string[], subtypes?: number}) {
    this.flags = options.flags
    this.types = options.types
    this.flagMask = Math.pow(2, this.flags.length) - 1
    this.typeShift = this.flags.length + 1
    let subtypes = options.subtypes || 0
    let parentNames: (string | undefined)[] = [undefined]
    this.typeIDs[""] = 0
    let typeID = 1
    for (let type of options.types) {
      let match = /^([\w\-]+)(?:=([\w-]+))?$/.exec(type)
      if (!match) throw new RangeError("Invalid type name " + type)
      let id = typeID++
      this.typeNames[id] = match[1]
      this.typeIDs[match[1]] = id
      parentNames[id] = match[2]
      for (let i = 0; i < subtypes; i++) {
        let subID = typeID++, name = match[1] + "#" + (i + 1)
        this.typeNames[subID] = name
        this.typeIDs[name] = subID
        parentNames[subID] = match[1]
      }
    }
    this.parents = parentNames.map(name => {
      if (name == null) return 0
      let id = this.typeIDs[name]
      if (id == null) throw new RangeError(`Unknown parent type '${name}' specified`)
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
        let typeID = this.typeIDs[part]
        if (typeID == null) throw new RangeError(`Unknown tag type '${part}'`)
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
    return [
      EditorView.plugin.of(view => new Highlighter(view, this.prop, styling)),
      EditorView.styleModule.of(styling.module)
    ]
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
/// themes.
export const defaultTags = new TagSystem({
  flags: ["invalid", "meta",
          "link", "strong", "emphasis", "monospace",
          "changed", "inserted", "deleted",
          "definition", "constant", "control"],
  subtypes: 7,
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
    "literal",
    "string=literal",
    "character=string",
    "number=literal",
    "integer=number",
    "float=number",
    "regexp=literal",
    "escape=literal",
    "color=literal",
    "content",
    "heading=content",
    "list=content",
    "quote=content",
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
    "typeOperator=operator",
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

class Highlighter extends ViewPlugin {
  tree: Tree

  constructor(view: EditorView, private prop: NodeProp<number>, private styling: Styling) {
    super()
    this.tree = view.state.tree
    this.decorations = this.buildDeco(view.viewport, this.tree)
  }

  update(update: ViewUpdate) {
    let syntax = update.state.facet(EditorState.syntax)
    if (!syntax.length) {
      this.decorations = Decoration.none
    } else if (syntax[0].parsePos(update.state) < update.view.viewport.to) {
      this.decorations = this.decorations.map(update.changes)
    } else if (this.tree != syntax[0].getTree(update.state) || update.viewportChanged) {
      this.tree = syntax[0].getTree(update.state)
      this.decorations = this.buildDeco(update.view.viewport, this.tree)
    }
  }

  buildDeco({from, to}: {from: number, to: number}, tree: Tree) {
    let tokens: Range<Decoration>[] = []
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
    return Decoration.set(tokens)
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
