import {Tree, NodeProp} from "lezer-tree"
import {Style, StyleModule} from "style-mod"
import {EditorView, ViewPlugin, PluginValue, ViewUpdate, Decoration, DecorationSet} from "@codemirror/next/view"
import {EditorState, Extension, precedence} from "@codemirror/next/state"
import {RangeSetBuilder} from "@codemirror/next/rangeset"

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

  /// @internal
  prop = new NodeProp<Rule>()

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
    this.typeShift = this.flags.length
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
    if (this.flags.length > 30 || this.typeNames.length > Math.pow(2, 30 - this.flags.length))
      throw new RangeError("Too many style tag flags to fit in a 30-bit integer")
  }

  /// @internal
  get(name: string) {
    let value = 0
    for (let part of name.split(" ")) if (part) {
      let flag = this.flags.indexOf(part)
      if (flag > -1) {
        value += 1 << flag
      } else {
        let typeID = this.typeIDs[part]
        if (typeID == null) throw new RangeError(`Unknown tag type '${part}'`)
        if (value >> this.typeShift) throw new RangeError(`Multiple tag types specified in '${name}'`)
        value += typeID << this.typeShift
      }
    }
    return value
  }

  /// @internal
  getWithMode(name: string) {
    let mode = name[0] == "+" ? Mode.Inherit : name[0] == "!" ? Mode.Opaque : Mode.Normal
    return {mode, tag: this.get(mode == Mode.Normal ? name : name.slice(1))}
  }

  /// Manually add a highlighting tag to a set of node props.
  addTagProp(name: string, props: {[prop: number]: any} = {}) {
    let {mode, tag} = this.getWithMode(name)
    return this.prop.set(props, new Rule(tag, mode, noContext))
  }

  /// Create a
  /// [`PropSource`](https://lezer.codemirror.net/docs/ref#tree.PropSource)
  /// that adds node properties for this system. See
  /// [`styleTags`](#highlight.styleTags) for documentation of the
  /// argument object.
  add(tags: {[selector: string]: string}) {
    let byName: {[name: string]: Rule} = Object.create(null)
    for (let prop in tags) {
      let value = tags[prop]
      let {mode, tag} = this.getWithMode(value)
      for (let part of prop.split(" ")) {
        let stack = part.split("/"), inner = stack[stack.length - 1]
        let context = stack.length > 1 ? stack.slice(0, stack.length - 1).map(s => s == "*" ? null : s) : noContext
        let rule = new Rule(tag, mode, context)
        byName[inner] = rule.sort(byName[inner])
      }
    }
    return this.prop.add(byName)
  }

  /// Create a highlighter extension for this system, styling the
  /// given tags using the given CSS objects.
  highlighter(spec: {[tag: string]: Style}): Extension {
    let styling = new Styling(this, spec)
    return [
      precedence(ViewPlugin.define(view => new Highlighter(view, this.prop, styling)).decorations(), "fallback"),
      EditorView.styleModule.of(styling.module)
    ]
  }

  /// @internal
  specificity(tag: number) {
    let flags = tag & this.flagMask, spec = 0
    for (let i = 1; i <= this.flags.length; i++)
      if (flags & (1 << i)) spec++
    for (let type = tag >> this.typeShift; type; type = this.parents[type]) spec += 1000
    return spec
  }
}

/// The set of highlighting tags used by regular language packages and
/// themes.
export const defaultTags = new TagSystem({
  flags: ["invalid", "meta", "standard",
          "definition", "constant", "local", "control",
          "link", "strong", "emphasis", "monospace",
          "changed", "inserted", "deleted"],
  subtypes: 7,
  types: [
    "comment",
    "lineComment=comment",
    "blockComment=comment",
    "docComment=comment",
    "name",
    "variableName=name",
    "typeName=name",
    "propertyName=name",
    "className=name",
    "labelName=name",
    "functionName=name",
    "namespace=name",
    "literal",
    "string=literal",
    "docString=string",
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

const enum Mode { Opaque, Inherit, Normal }

const noContext: readonly (string | null)[] = []

class Rule {
  constructor(readonly tag: number,
              readonly mode: Mode,
              readonly context: readonly (string | null)[],
              public next?: Rule) {}

  sort(other: Rule | undefined) {
    if (!other || other.context.length < this.context.length) {
      this.next = other
      return this
    }
    other.next = this.sort(other.next)
    return other
  }
}

/// Used to add a set of tags to a language syntax via
/// [`Parser.withProps`](https://lezer.codemirror.net/docs/ref#lezer.Parser.withProps).
///
/// The argument object maps node selectors to [tag
/// names](#highlight.TagSystem), optionally prefixed with:
///
///  - `+`, to make the style apply not just to the node itself, but
///    also to child nodes (which by default replace the styles
///    assigned by their parent nodes)
///
///  - `!` to make a node _opaque_, meaning its child nodes are
///    ignored for styling purposes.
///
/// Node selectors can be [node
/// names](https://lezer.codemirror.net/docs/ref#tree.NodeType.name),
/// or groups of node names separated by spaces. It is possible to
/// combine multiple node names with slashes, as in
/// `"Block/Declaration/VariableName"`, to match the final node but
/// only if its direct parent nodes are the other nodes mentioned. A
/// `*` can be used as a wildcard in such a path. (But only matches a
/// single parent—wildcards that match multiple parents aren't
/// supported, both for efficiency reasons and because Lezer trees
/// make it rather hard to reason about what they would match.)
///
/// For example:
///
/// ```javascript
/// parser.withProps(
///   styleTags({
///     // Style Number and BigNumber nodes
///     "Number BigNumber": "number",
///     // Style Escape nodes whose parent is String
///     "String/Escape": "escape",
///     // Style anything inside Attributes nodes
///     "Attributes": "!meta",
///     // Add a style to all content inside Italic nodes
///     "Italic": "+emphasis"
///   })
/// )
/// ```
export const styleTags = (tags: {[selector: string]: string}) => defaultTags.add(tags)

/// Create a highlighter theme that adds the given styles to the given
/// tags. The spec's property names must be [tag
/// names](#highlight.defaultTags) or comma-separated lists of tag
/// names. The values should be
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
      let cls = "c" + nextCls++
      modSpec[cls] = spec[prop]
      for (let part of prop.split(/\s*,\s*/)) {
        let tag = tags.get(part)
        rules.push(new StyleRule(tag >> tags.typeShift, tag & tags.flagMask, tags.specificity(tag), cls))
      }
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

class Highlighter implements PluginValue {
  tree: Tree
  decorations: DecorationSet

  // Reused stacks for buildDeco
  nodeStack: string[] = [""]
  classStack: string[] = [""]
  inheritStack: string[] = [""]

  constructor(view: EditorView, private prop: NodeProp<Rule>, private styling: Styling) {
    this.tree = view.state.tree
    this.decorations = this.buildDeco(view.visibleRanges, this.tree)
  }

  update(update: ViewUpdate) {
    let syntax = update.state.facet(EditorState.syntax)
    if (!syntax.length) {
      this.decorations = Decoration.none
    } else if (syntax[0].parsePos(update.state) < update.view.viewport.to) {
      this.decorations = this.decorations.map(update.changes)
    } else if (this.tree != syntax[0].getTree(update.state) || update.viewportChanged) {
      this.tree = syntax[0].getTree(update.state)
      this.decorations = this.buildDeco(update.view.visibleRanges, this.tree)
    }
  }

  buildDeco(ranges: readonly {from: number, to: number}[], tree: Tree) {
    let builder = new RangeSetBuilder<Decoration>()
    let start: number, curClass: string, depth: number
    function flush(pos: number, style: string) {
      if (pos > start && style)
        builder.add(start, pos, Decoration.mark({class: style})) // FIXME cache these
      start = pos
    }

    let {nodeStack, classStack, inheritStack} = this
    for (let {from, to} of ranges) {
      curClass = ""; depth = 0; start = from
      tree.iterate({
        from, to,
        enter: (type, start) => {
          depth++
          let inheritedClass = inheritStack[depth - 1]
          let cls = inheritedClass
          let rule = type.prop(this.prop), opaque = false
          while (rule) {
            if (!rule.context.length || matchContext(rule.context, nodeStack, depth)) {
              let style = this.styling.match(rule.tag)
              if (style) {
                if (cls) cls += " "
                cls += style
                if (rule.mode == Mode.Inherit) inheritedClass = cls
                else if (rule.mode == Mode.Opaque) opaque = true
              }
              break
            }
            rule = rule.next
          }
          if (cls != curClass) {
            flush(start, curClass)
            curClass = cls
          }
          if (opaque) {
            depth--
            return false
          }
          classStack[depth] = cls
          inheritStack[depth] = inheritedClass
          nodeStack[depth] = type.name
          return undefined
        },
        leave: (_t, _s, end) => {
          depth--
          let backTo = classStack[depth]
          if (backTo != curClass) {
            flush(Math.min(to, end), curClass)
            curClass = backTo
          }
        }
      })
    }
    return builder.finish()
  }
}

function matchContext(context: readonly (null | string)[], stack: readonly string[], depth: number) {
  if (context.length > depth - 1) return false
  for (let d = depth - 1, i = context.length - 1; i >= 0; i--, d--) {
    let check = context[i]
    if (check && check != stack[d]) return false
  }
  return true
}

/// A default highlighter (works well with light themes).
export const defaultHighlighter = highlighter({
  deleted: {textDecoration: "line-through"},
  inserted: {textDecoration: "underline"},
  link: {textDecoration: "underline"},
  strong: {fontWeight: "bold"},
  emphasis: {fontStyle: "italic"},
  invalid: {color: "#f00"},
  keyword: {color: "#708"},
  atom: {color: "#219"},
  number: {color: "#164"},
  string: {color: "#a11"},
  "regexp, escape": {color: "#e40"},
  "variableName definition": {color: "#00f"},
  typeName: {color: "#085"},
  className: {color: "#167"},
  "propertyName definition": {color: "#00c"},
  comment: {color: "#940"},
  meta: {color: "#555"},
})
