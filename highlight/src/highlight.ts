import {Tree, NodeProp} from "lezer-tree"
import {StyleSpec, StyleModule} from "style-mod"
import {EditorView, ViewPlugin, PluginValue, ViewUpdate, Decoration, DecorationSet} from "@codemirror/next/view"
import {EditorState, Extension, precedence} from "@codemirror/next/state"
import {RangeSetBuilder} from "@codemirror/next/rangeset"

// For each tag, this holds the set of tags that match it, in order of
// specificity. The set always contains the tag itself
// (`tagSets[i].includes(i)` is true for any defined tag).
const tagSets: (readonly number[])[] = []

/// Highlighting tags are markers that denote a highlighting category.
/// They are [associated](#highlight.styleTags) with parts of a syntax
/// tree by a language mode, and then mapped to an actual CSS style by
/// a [highlighter](#highlight.highlighter).
///
/// CodeMirror uses a mostly-closed set of tags for generic
/// highlighters, so that the list of things that a theme must style
/// is clear and bounded (as opposed to traditional open string-based
/// systems, which make it very hard for highlighting themes to cover
/// all the styles produced by the various languages).
///
/// It _is_ possible to [define](#highlight.defineTag) your own
/// highlighting tags for system-internal use (where you control both
/// the language package and the highlighter), but such tags will not
/// be picked up by other highlighters (though you can derive them
/// from standard tags to allow the highlighters to fall back to
/// those).
///
/// Tags are represented as strings for practical purposes (so that
/// they can be used as object property names in
/// [highlighter](#highlight.highlighter) and so that they can be
/// concatenated with `+`), but their content should not be treated as
/// meaningful, and they should _definitely_ not be created in any
/// other way than [`defineTag`](#highlight.defineTag).
export type Tag = string

function read(tag: Tag) {
  let m = /^⟬(\d+)⟭$/.exec(tag), val = m ? +m[1] : 1e8
  if (val >= tagSets.length) throw new RangeError("Invalid tag " + tag)
  return val
}

function toTag(id: number) { return `⟬${id}⟭` }

function readSet(tags: string) { return tags.split(/(?=⟬)/).map(read) }

/// Define a new tag. If `parent` is given, the tag is treated as a
/// sub-tag of that parent, and [highlighters](#highlight.highliter)
/// that don't mention this tag will try to fall back to the parent
/// tag (or grandparent tag, etc).
export function defineTag(parent?: Tag): Tag {
  let id = tagSets.length, set = [id]
  if (parent) {
    let id = read(parent)
    set = set.concat(tagSets[id])
  }
  tagSets.push(set)
  return toTag(id)
}

let modifierID = 0
const modified: {orig: number, mods: readonly number[], tag: number}[] = []

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a.length == b.length && a.every((x, i) => x == b[i])
}

function permute<T>(array: readonly T[]): (readonly T[])[] {
  let result = [array]
  for (let i = 0; i < array.length; i++) {
    for (let a of permute(array.slice(0, i).concat(array.slice(i + 1)))) result.push(a)
  }
  return result
}

function getModified(orig: number, mods: readonly number[]) {
  if (!mods.length) return orig
  let exists = modified.find(m => m.orig == orig && sameArray(mods, m.mods))
  if (exists) return exists.tag
  let tag = tagSets.length
  modified.push({orig, mods, tag})
  let configs = permute(mods), set = []
  for (let parent of tagSets[orig]) for (let config of configs)
    set.push(getModified(parent, config))
  tagSets.push(set)
  return tag
}

/// Define a tag _modifier_, which is a function that, given a tag,
/// will return a tag that is a subtag of the original. Applying the
/// same modifier to a twice tag will return the same value (`m1(t1)
/// == m1(t1)`) and applying multiple modifiers will, regardless or
/// order, produce the same tag (`m1(m2(t1)) == m2(m1(t1))`).
///
/// When multiple modifiers are applied to a given base tag, each
/// smaller set of modifiers is registered as a parent, so that for
/// example `m1(m2(m3(t1)))` is a subtype of `m1(m2(t1))`,
/// `m1(m3(t1)`, and so on.
export function defineTagModifier() {
  let modID = modifierID++
  return (tag: Tag) => {
    let id = read(tag)
    let known = modified.find(m => m.tag == id)
    if (known && known.mods.indexOf(modID) > -1) return tag
    return toTag(getModified(known ? known.orig : id, (known ? known.mods : []).concat(modID).sort((a, b) => a - b)))
  }
}

/// Used to add a set of tags to a language syntax via
/// [`Parser.withProps`](https://lezer.codemirror.net/docs/ref#lezer.Parser.withProps).
///
/// The argument object maps node selectors to [highlighting
/// tags](#highlight.Tag) or sets of tags (created by concatenating
/// them with the `+` operator).
///
/// Node selectors may hold one or more (space-separated) node paths.
/// Such a path can be a [node
/// name](https://lezer.codemirror.net/docs/ref#tree.NodeType.name),
/// or multiple node names (or `*` wildcards) separated by slash
/// characters, as in `"Block/Declaration/VariableName"`. Such a path
/// matches the final node but only if its direct parent nodes are the
/// other nodes mentioned. A `*` in such a path matches any parent,
/// but only a single level—wildcards that match multiple parents
/// aren't supported, both for efficiency reasons and because Lezer
/// trees make it rather hard to reason about what they would match.)
///
/// A path can be ended with `/...` to indicate that the tag assigned
/// to the node should also apply to all parent nodes, even if they
/// match their own style (by default, only the innermost style is
/// used).
///
/// When a path ends in `!`, as in `Attribute!`, no further matching
/// happens for the node's child nodes, and the entire node gets the
/// given style.
///
/// In this notation, node names that contain `/`, `!`, `*`, or `...`
/// must be quoted as JSON strings.
///
/// For example:
///
/// ```javascript
/// parser.withProps(
///   styleTags({
///     // Style Number and BigNumber nodes
///     "Number BigNumber": tags.number,
///     // Style Escape nodes whose parent is String
///     "String/Escape": tags.escape,
///     // Style anything inside Attributes nodes
///     "Attributes!": tags.meta,
///     // Add a style to all content inside Italic nodes
///     "Italic/...": tags.emphasis,
///     // Style InvalidString nodes as both `string` and `invalid`
///     "InvalidString": tags.string + tags.invalid,
///     // Style the node named "/" as punctuation
///     '"/"': tags.punctuation
///   })
/// )
/// ```
export function styleTags(tags: {[selector: string]: Tag}) {
  let byName: {[name: string]: Rule} = Object.create(null)
  for (let prop in tags) {
    let tagIDs = readSet(tags[prop])
    for (let part of prop.split(" ")) if (part) {
      let pieces: (string | null)[] = [], mode = Mode.Normal
      for (let pos = 0; pos < part.length;) {
        let rest = part.slice(pos)
        if (rest == "/...") { mode = Mode.Inherit; break }
        if (rest == "!") { mode = Mode.Opaque; break }
        let m = /^"(?:[^"\\]|\\.)*?"|[^\/!]+/.exec(rest)
        if (!m) throw new RangeError("Invalid path: " + part)
        pieces.push(m[0] == "*" ? null : m[0][0] == '"' ? JSON.parse(m[0]) : m[0])
        pos += m[0].length + 1
        if (pos <= part.length && part[pos - 1] != "/") throw new RangeError("Invalid path: " + part)
      }
      let last = pieces.length - 1, inner = pieces[last]
      if (!inner) throw new RangeError("Invalid path: " + part)
      for (let tag of tagIDs) {
        let rule = new Rule(tag, mode, last > 0 ? pieces.slice(0, last) : null)
        byName[inner] = rule.sort(byName[inner])
      }
    }
  }
  return ruleNodeProp.add(byName)
}

const ruleNodeProp = new NodeProp<Rule>()

/// Create a highlighter theme that adds the given styles to the given
/// tags. The spec's property names must be [tags](#highlight.Tag) or
/// lists of tags (which can be concatenated with `+`). The values
/// should be
/// [`style-mod`](https://github.com/marijnh/style-mod#documentation)
/// style objects that define the CSS for that tag.
///
/// The CSS rules created for a highlighter will be emitted in the
/// order of the spec's properties. That means that for elements that
/// have multiple tags associated with them, styles defined further
/// down in the list will have a higher CSS precedence than styles
/// defined earlier.
export function highlighter(spec: {[tag: string]: StyleSpec}): Extension {
  let styling = new Styling(spec)
  return [
    precedence(ViewPlugin.define<Highlighter>(view => new Highlighter(view, styling), {
      decorations: v => v.decorations
    }), "fallback"),
    EditorView.styleModule.of(styling.module)
  ]
}

const t = defineTag

const comment = t(), name = t(),
  literal = t(), string = t(literal), number = t(literal),
  content = t(), heading = t(content), keyword = t(), operator = t(),
  punctuation = t(), bracket = t(punctuation), meta = t()

/// The default set of highlighting [tags](#highlight.defineTag) used
/// by regular language packages and themes.
///
/// Note that it is not obligatory to always attach the most specific
/// tag possible to an element—if your grammar can't easily
/// distinguish a certain type of element, it is okay to style it as
/// its more general variant.
/// 
/// For tags that extend some parent tag, the
/// documentation links to the parent.
export const tags = {
  /// A comment.
  comment,
  /// A line [comment](#highlight.tags.comment).
  lineComment: t(comment),
  /// A block [comment](#highlight.tags.comment).
  blockComment: t(comment),
  /// A documentation [comment](#highlight.tags.comment).
  docComment: t(comment),

  /// Any kind of identifier.
  name,
  /// The [name](#highlight.tags.name) of a variable.
  variableName: t(name),
  /// A type or tag [name](#highlight.tags.name).
  typeName: t(name),
  /// A property, field, or attribute [name](#highlight.tags.name).
  propertyName: t(name),
  /// The [name](#highlight.tags.name) of a class.
  className: t(name),
  /// A label [name](#highlight.tags.name).
  labelName: t(name),
  /// A namespace [name](#highlight.tags.name).
  namespace: t(name),
  /// The [name](#highlight.tags.name) of a macro.
  macroName: t(name),

  /// A literal value.
  literal,
  /// A string [literal](#highlight.tags.literal).
  string,
  /// A documentation [string](#highlight.tags.string).
  docString: t(string),
  /// A character literal (subtag of [string](#highlight.tags.string)).
  character: t(string),
  /// A number [literal](#highlight.tags.literal).
  number,
  /// An integer [number](#highlight.tags.number) literal.
  integer: t(number),
  /// A floating-point [number](#highlight.tags.number) literal.
  float: t(number),
  /// A boolean [literal](#highlight.tags.literal).
  bool: t(literal),
  /// Regular expression [literal](#highlight.tags.literal).
  regexp: t(literal),
  /// An escape [literal](#highlight.tags.literal), for example a
  /// backslash escape in a string.
  escape: t(literal),
  /// A color [literal](#highlight.tags.literal).
  color: t(literal),

  /// A language keyword.
  keyword,
  /// The [keyword](#highlight.tags.keyword) for the self or this
  /// object.
  self: t(keyword),
  /// The [keyword](#highlight.tags.keyword) for null.
  null: t(keyword),
  /// A [keyword](#highlight.tags.keyword) denoting some atomic value.
  atom: t(keyword),
  /// A [keyword](#highlight.tags.keyword) that represents a unit.
  unit: t(keyword),
  /// A modifier [keyword](#highlight.tags.keyword).
  modifier: t(keyword),
  /// A [keyword](#highlight.tags.keyword) that acts as an operator.
  operatorKeyword: t(keyword),
  /// A control-flow related [keyword](#highlight.tags.keyword).
  controlKeyword: t(keyword),
  /// A [keyword](#highlight.tags.keyword) that defines something.
  definitionKeyword: t(keyword),

  /// An operator.
  operator,
  /// An [operator](#highlight.tags.operator) that defines something.
  derefOperator: t(operator),
  /// Arithmetic-related [operator](#highlight.tags.operator).
  arithmeticOperator: t(operator),
  /// Logical [operator](#highlight.tags.operator).
  logicOperator: t(operator),
  /// Bit [operator](#highlight.tags.operator).
  bitwiseOperator: t(operator),
  /// Comparison [operator](#highlight.tags.operator).
  compareOperator: t(operator),
  /// [Operator](#highlight.tags.operator) that updates its operand.
  updateOperator: t(operator),
  /// [Operator](#highlight.tags.operator) that defines something.
  definitionOperator: t(operator),
  /// Type-related [operator](#highlight.tags.operator).
  typeOperator: t(operator),
  /// Control-flow [operator](#highlight.tags.operator).
  controlOperator: t(operator),

  /// Program or markup punctuation.
  punctuation,
  /// [Punctuation](#highlight.tags.punctuation) that separates
  /// things.
  separator: t(punctuation),
  /// Bracket-style [punctuation](#highlight.tags.punctuation).
  bracket,
  /// Angle [brackets](#highlight.tags.bracket) (usually `<` and `>`
  /// tokens).
  angleBracket: t(bracket),
  /// Square [brackets](#highlight.tags.bracket) (usually `[` and `]`
  /// tokens).
  squareBracket: t(bracket),
  /// Parentheses (usually `(` and `)` tokens). Subtag of
  /// [bracket](#highlight.tags.bracket)).
  paren: t(bracket),
  /// Braces (usually `{` and `}` tokens). Subtag of
  /// [bracket](#highlight.tags.bracket)).
  brace: t(bracket),

  /// Content, for example plain text in XML or markup documents.
  content,
  /// [Content](#highlight.tags.content) that represents a heading.
  heading,
  /// A level 1 [heading](#highlight.tags.heading).
  heading1: t(heading),
  /// A level 2 [heading](#highlight.tags.heading).
  heading2: t(heading),
  /// A level 3 [heading](#highlight.tags.heading).
  heading3: t(heading),
  /// A level 4 [heading](#highlight.tags.heading).
  heading4: t(heading),
  /// A level 5 [heading](#highlight.tags.heading).
  heading5: t(heading),
  /// A level 6 [heading](#highlight.tags.heading).
  heading6: t(heading),
  /// [Content](#highlight.tags.content) that represents a list or
  /// list marker.
  list: t(content),
  /// [Content](#highlight.tags.content) that represents a quote.
  quote: t(content),
  /// [Content](#highlight.tags.content) that is emphasized.
  emphasis: t(content),
  /// [Content](#highlight.tags.content) that is styled strong.
  strong: t(content),
  /// [Content](#highlight.tags.content) that is styled as code or
  /// monospace.
  monospace: t(content),

  /// Inserted content in a change-tracking format.
  inserted: t(),
  /// Deleted content.
  deleted: t(),
  /// Changed content.
  changed: t(),

  /// An invalid or unsyntactic element.
  invalid: t(),

  /// Metadata or meta-instruction.
  meta,
  /// [Metadata](#higlight.tags.meta) that applies to the entire
  /// document.
  documentMeta: t(meta),
  /// [Metadata](#higlight.tags.meta) that annotates or adds
  /// attributes to a given syntactic element.
  annotation: t(meta),
  /// Processing instruction or preprocessor directive. Subtag of
  /// [meta](#highlight.tags.meta)).
  processingInstruction: t(meta),

  /// [Modifier](#highlight.defineTagModifier) that indicates that a
  /// given element is being defined. Expected to be used with the
  /// various [name](#higlight.tags.name) tags.
  definition: defineTagModifier(),
  /// [Modifier](#highlight.defineTagModifier) that indicates that
  /// something is constant. Mostly expected to be used with
  /// [variable names](#highlight.tags.variableName).
  constant: defineTagModifier(),
  /// [Modifier](#highlight.defineTagModifier) used to indicate that a
  /// [variable name](#highlight.tags.variableName) is being called or
  /// being defined as a function.
  function: defineTagModifier(),
  /// [Modifier](#highlight.defineTagModifier) that can be applied to
  /// [names](#highlight.tags.name) to indicate that they belong to
  /// the standard environment.
  standard: defineTagModifier(),
  /// [Modifier](#highlight.defineTagModifier) that indicates a given
  /// [names](#highlight.tags.name) is local to some scope.
  local: defineTagModifier(),

  /// A generic variant [modifier](#highlight.defineTagModifier) that
  /// can be used to tag language-specific alternative variants of
  /// some common tag. It is recommended for themes to define special
  /// forms of at least the [string](#highlight.tags.string) and
  /// [variable name](#highlight.tags.variableName) tags, since those
  /// come up a lot.
  special: defineTagModifier()
}

const enum Mode { Opaque, Inherit, Normal }

class Rule {
  constructor(readonly tag: number,
              readonly mode: Mode,
              readonly context: readonly (string | null)[] | null,
              public next?: Rule) {}

  sort(other: Rule | undefined) {
    if (!other || other.depth < this.depth) {
      this.next = other
      return this
    }
    other.next = this.sort(other.next)
    return other
  }

  get depth() { return this.context ? this.context.length : 0 }
}

class Styling {
  module: StyleModule
  map: (string | null)[] = []

  constructor(spec: {[name: string]: StyleSpec}) {
    let modSpec = Object.create(null)
    let found: {[id: number]: string | null} = Object.create(null)
    for (let prop in spec) {
      let cls = StyleModule.newName()
      modSpec["." + cls] = spec[prop]
      for (let tag of readSet(prop)) found[tag] = cls
    }
    this.module = new StyleModule(modSpec)
    for (let i = 0; i < tagSets.length; i++) {
      let value = null
      for (let id of tagSets[i]) if (found[id]) {
        value = found[id]
        break
      }
      this.map[i] = value
    }
  }
}

class Highlighter implements PluginValue {
  tree: Tree
  decorations: DecorationSet

  // Reused stacks for buildDeco
  nodeStack: string[] = [""]
  classStack: string[] = [""]
  inheritStack: string[] = [""]

  constructor(view: EditorView, private styling: Styling) {
    this.tree = view.state.tree
    this.decorations = this.buildDeco(view.visibleRanges)
  }

  update(update: ViewUpdate) {
    let syntax = update.state.facet(EditorState.syntax)
    if (!syntax.length) {
      this.decorations = Decoration.none
    } else if (syntax[0].parsePos(update.state) < update.view.viewport.to) {
      this.decorations = this.decorations.map(update.changes)
    } else if (this.tree != syntax[0].getTree(update.state) || update.viewportChanged) {
      this.tree = syntax[0].getTree(update.state)
      this.decorations = this.buildDeco(update.view.visibleRanges)
    }
  }

  buildDeco(ranges: readonly {from: number, to: number}[]) {
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
      this.tree.iterate({
        from, to,
        enter: (type, start) => {
          depth++
          let inheritedClass = inheritStack[depth - 1]
          let cls = inheritedClass
          let rule = type.prop(ruleNodeProp), opaque = false, matched = -1
          if (rule) do {
            if (!rule.context || matchContext(rule.context, nodeStack, depth)) {
              let style = this.styling.map[rule.tag]
              if (style) {
                if (cls) cls += " "
                cls += style
                if (rule.mode == Mode.Inherit) inheritedClass = cls
                else if (rule.mode == Mode.Opaque) opaque = true
              }
              matched = rule.depth
            }
            rule = rule.next
          } while (rule && rule.depth >= matched)
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
  [tags.deleted]: {textDecoration: "line-through"},
  [tags.inserted + tags.heading]: {textDecoration: "underline"},
  [tags.emphasis]: {fontStyle: "italic"},
  [tags.keyword]: {color: "#708"},
  [tags.atom + tags.bool]: {color: "#219"},
  [tags.number]: {color: "#164"},
  [tags.string]: {color: "#a11"},
  [tags.regexp + tags.escape + tags.special(tags.string)]: {color: "#e40"},
  [tags.definition(tags.variableName)]: {color: "#00f"},
  [tags.typeName]: {color: "#085"},
  [tags.className]: {color: "#167"},
  [tags.special(tags.variableName)]: {color: "#256"},
  [tags.definition(tags.propertyName)]: {color: "#00c"},
  [tags.comment]: {color: "#940"},
  [tags.meta]: {color: "#555"},
  [tags.invalid]: {color: "#f00"},
})
