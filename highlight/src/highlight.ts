import {Tree, NodeProp} from "lezer-tree"
import {StyleSpec, StyleModule} from "style-mod"
import {EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet} from "@codemirror/next/view"
import {Extension, precedence, Facet} from "@codemirror/next/state"
import {Language} from "@codemirror/next/language"
import {RangeSetBuilder} from "@codemirror/next/rangeset"

let nextTagID = 0

/// Highlighting tags are markers that denote a highlighting category.
/// They are [associated](#highlight.styleTags) with parts of a syntax
/// tree by a language mode, and then mapped to an actual CSS style by
/// a [highlight style](#highlight.highlightStyle).
///
/// CodeMirror uses a mostly-closed set of tags for generic
/// highlighters, so that the list of things that a theme must style
/// is clear and bounded (as opposed to traditional open string-based
/// systems, which make it hard for highlighting themes to cover all
/// the tokens produced by the various languages).
///
/// It _is_ possible to [define](#highlight.Tag^define) your own
/// highlighting tags for system-internal use (where you control both
/// the language package and the highlighter), but such tags will not
/// be picked up by other highlighters (though you can derive them
/// from standard tags to allow the highlighters to fall back to
/// those).
export class Tag {
  /// @internal
  id = nextTagID++

  /// @internal
  constructor(
    /// The set of tags that match this tag, starting with this one
    /// itself, sorted in order of decreasing specificity. @internal
    readonly set: Tag[],
    /// The base unmodified tag that this one is based on, if it's
    /// modified @internal
    readonly base: Tag | null,
    /// The modifiers applied to this.base @internal
    readonly modified: readonly Modifier[]
  ) {}

  /// Define a new tag. If `parent` is given, the tag is treated as a
  /// sub-tag of that parent, and [highlight
  /// styles](#highlight.highlightStyle) that don't mention this tag
  /// will try to fall back to the parent tag (or grandparent tag,
  /// etc).
  static define(parent?: Tag): Tag {
    if (parent?.base) throw new Error("Can not derive from a modified tag")
    let tag = new Tag([], null, [])
    tag.set.push(tag)
    if (parent) for (let t of parent.set) tag.set.push(t)
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
  static defineModifier(): (tag: Tag) => Tag {
    let mod = new Modifier
    return (tag: Tag) => {
      if (tag.modified.indexOf(mod) > -1) return tag
      return Modifier.get(tag.base || tag, tag.modified.concat(mod).sort((a, b) => a.id - b.id))
    }
  }
}

let nextModifierID = 0

class Modifier {
  instances: Tag[] = []
  id = nextModifierID++

  static get(base: Tag, mods: readonly Modifier[]) {
    if (!mods.length) return base
    let exists = mods[0].instances.find(t => t.base == base && sameArray(mods, t.modified))
    if (exists) return exists
    let set: Tag[] = [], tag = new Tag(set, base, mods)
    for (let m of mods) m.instances.push(tag)
    let configs = permute(mods)
    for (let parent of base.set) for (let config of configs)
      set.push(Modifier.get(parent, config))
    return tag
  }
}

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

/// This function is used to add a set of tags to a language syntax
/// via
/// [`Parser.configure`](https://lezer.codemirror.net/docs/ref#lezer.Parser.configure).
///
/// The argument object maps node selectors to [highlighting
/// tags](#highlight.Tag) or arrays of tags.
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
export function styleTags(spec: {[selector: string]: Tag | readonly Tag[]}) {
  let byName: {[name: string]: Rule} = Object.create(null)
  for (let prop in spec) {
    let tags = spec[prop]
    if (!Array.isArray(tags)) tags = [tags as Tag]
    for (let part of prop.split(" ")) if (part) {
      let pieces: (string | null)[] = [], mode = Mode.Normal, rest = part
      for (let pos = 0;;) {
        if (rest == "..." && pos > 0 && pos + 3 == part.length) { mode = Mode.Inherit; break }
        let m = /^"(?:[^"\\]|\\.)*?"|[^\/!]+/.exec(rest)
        if (!m) throw new RangeError("Invalid path: " + part)
        pieces.push(m[0] == "*" ? null : m[0][0] == '"' ? JSON.parse(m[0]) : m[0])
        pos += m[0].length
        if (pos == part.length) break
        let next = part[pos++]
        if (pos == part.length && next == "!") { mode = Mode.Opaque; break }
        if (next != "/") throw new RangeError("Invalid path: " + part)
        rest = part.slice(pos)
      }
      let last = pieces.length - 1, inner = pieces[last]
      if (!inner) throw new RangeError("Invalid path: " + part)
      let rule = new Rule(tags, mode, last > 0 ? pieces.slice(0, last) : null)
      byName[inner] = rule.sort(byName[inner])
    }
  }
  return ruleNodeProp.add(byName)
}

const ruleNodeProp = new NodeProp<Rule>()

const highlightStyleProp = Facet.define<HighlightStyle, HighlightStyle | null>({
  combine(stylings) { return stylings.length ? stylings[0] : null }
})

const enum Mode { Opaque, Inherit, Normal }

class Rule {
  constructor(readonly tags: readonly Tag[],
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

export class HighlightStyle {
  /// Extension that registers this style with an editor.
  readonly extension: Extension

  /// A style module holding the CSS rules for this highlight style. If you use 
  readonly module: StyleModule

  private map: {[tagID: number]: string | null} = Object.create(null)

  private constructor(spec: readonly (StyleSpec & {tag: Tag | readonly Tag[]})[]) {
    let modSpec = Object.create(null)
    for (let style of spec) {
      let cls = StyleModule.newName()
      modSpec["." + cls] = Object.assign({}, style, {tag: null})
      let tags = style.tag
      if (!Array.isArray(tags)) tags = [tags as Tag]
      for (let tag of tags) this.map[tag.id] = cls
    }
    this.module = new StyleModule(modSpec)
    this.match = this.match.bind(this)
    this.extension = [
      highlightStyleProp.of(this),
      EditorView.styleModule.of(this.module)
    ]
  }

  /// Returns the CSS class associated with the given tag, if any.
  match(tag: Tag) {
    for (let t of tag.set) {
      let match = this.map[t.id]
      if (match) {
        if (t != tag) this.map[tag.id] = match
        return match
      }
    }
    return this.map[tag.id] = null
  }

  /// Create a highlighter style that associates the given styles to the
  /// given tags. The spec's property names must be
  /// [tags](#highlight.Tag) or lists of tags (which can be concatenated
  /// with `+`). The values should be
  /// [`style-mod`](https://github.com/marijnh/style-mod#documentation)
  /// style objects that define the CSS for that tag.
  ///
  /// The CSS rules created for a highlighter will be emitted in the
  /// order of the spec's properties. That means that for elements that
  /// have multiple tags associated with them, styles defined further
  /// down in the list will have a higher CSS precedence than styles
  /// defined earlier.
  static define(...specs: readonly {tag: Tag | readonly Tag[], [prop: string]: any}[]) {
    return new HighlightStyle(specs)
  }
}


/// Given a string of code and a language, parse the code in that
/// language and run the tree highlighter over the resulting syntax
/// tree. For each differently-styled range, call `emit` with the
/// extend of the range and the CSS classes (as a space-separated
/// string) that apply to it. `emit` will be called with an empty
/// string for unstyled ranges.
export function highlightTree(
  tree: Tree,
  /// Get the CSS classes used to style a given [tag](#highlight.Tag),
  /// or `null` if it isn't styled.
  getStyle: (tag: Tag) => string | null,
  /// Assign styling to a region of the text. Will only be in order of
  /// position for any ranges where more than zero classes apply.
  /// `classes` is a space separated string of CSS classes.
  putStyle: (from: number, to: number, classes: string) => void
) {
  highlightTreeRange(tree, 0, tree.length, getStyle, putStyle)
}

/// Returns an extension that installs a highlighter that uses the
/// tree produced by the given language, along with the current
/// [highlight style](#highlight.highlightStyle), to style the
/// document. If no highlight style is active, this plugin won't do
/// any highlighting.
export function treeHighlighter(language: Language) {
  return precedence(ViewPlugin.define(view => new TreeHighlighter(view, language), {
    decorations: v => v.decorations
  }), "fallback")
}

class TreeHighlighter {
  decorations: DecorationSet
  tree: Tree
  markCache: {[cls: string]: Decoration} = Object.create(null)

  constructor(view: EditorView, private language: Language) {
    this.tree = language.getTree(view.state)
    this.decorations = this.buildDeco(view)
  }

  update(update: ViewUpdate) {
    if (this.language.getTree(update.state).length < update.view.viewport.to) {
      this.decorations = this.decorations.map(update.changes)
    } else {
      let tree = this.language.getTree(update.state)
      if (tree != this.tree || update.viewportChanged) {
        this.tree = tree
        this.decorations = this.buildDeco(update.view)
      }
    }
  }

  buildDeco(view: EditorView) {
    const style = view.state.facet(highlightStyleProp)
    if (!style) return Decoration.none

    let builder = new RangeSetBuilder<Decoration>()
    for (let {from, to} of view.visibleRanges) {
      highlightTreeRange(this.tree, from, to, style.match, (from, to, style) => {
        builder.add(from, to, this.markCache[style] || (this.markCache[style] = Decoration.mark({class: style})))
      })
    }
    return builder.finish()
  }
}

// Reused stacks for highlightTreeRange
const nodeStack = [""], classStack = [""], inheritStack = [""]

function highlightTreeRange(tree: Tree, from: number, to: number,
                       style: (tag: Tag) => string | null,
                       span: (from: number, to: number, cls: string) => void) {
  let spanStart = from, spanClass = "", depth = 0

  tree.iterate({
    from, to,
    enter: (type, start) => {
      depth++
      let inheritedClass = inheritStack[depth - 1]
      let cls = inheritedClass
      let rule = type.prop(ruleNodeProp), opaque = false
      while (rule) {
        if (!rule.context || matchContext(rule.context, nodeStack, depth)) {
          for (let tag of rule.tags) {
            let st = style(tag)
            if (st) {
              if (cls) cls += " "
              cls += st
              if (rule.mode == Mode.Inherit) inheritedClass = cls
              else if (rule.mode == Mode.Opaque) opaque = true
            }
          }
          break
        }
        rule = rule.next
      }
      if (cls != spanClass) {
        if (start > spanStart && spanClass) span(spanStart, start, spanClass)
        spanStart = start
        spanClass = cls
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
      if (backTo != spanClass) {
        let pos = Math.min(to, end)
        if (pos > spanStart && spanClass) span(spanStart, pos, spanClass)
        spanStart = pos
        spanClass = backTo
      }
    }
  })
}

function matchContext(context: readonly (null | string)[], stack: readonly string[], depth: number) {
  if (context.length > depth - 1) return false
  for (let d = depth - 1, i = context.length - 1; i >= 0; i--, d--) {
    let check = context[i]
    if (check && check != stack[d]) return false
  }
  return true
}

const t = Tag.define

const comment = t(), name = t(),
  literal = t(), string = t(literal), number = t(literal),
  content = t(), heading = t(content), keyword = t(), operator = t(),
  punctuation = t(), bracket = t(punctuation), meta = t()

/// The default set of highlighting [tags](#highlight.Tag^define) used
/// by regular language packages and themes.
///
/// This collection is heavily biasted towards programming language,
/// and necessarily incomplete. A full ontology of syntactic
/// constructs would fill a stack of books, and be impractical to
/// write themes for. So try to make do with this set, possibly
/// encoding more information with flags. If all else fails, [open an
/// issue](https://github.com/codemirror/codemirror.next) to propose a
/// new type, or [define](#highlight.Tag^define) a custom tag for your
/// use case.
///
/// Note that it is not obligatory to always attach the most specific
/// tag possible to an element—if your grammar can't easily
/// distinguish a certain type of element, it is okay to style it as
/// its more general variant.
/// 
/// For tags that extend some parent tag, the documentation links to
/// the parent.
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
  /// A URL [literal](#highlight.tags.literal).
  url: t(literal),

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
  /// [Content](#highlight.tags.content) that is part of a link.
  link: t(content),
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
  /// [Metadata](#highlight.tags.meta) that applies to the entire
  /// document.
  documentMeta: t(meta),
  /// [Metadata](#highlight.tags.meta) that annotates or adds
  /// attributes to a given syntactic element.
  annotation: t(meta),
  /// Processing instruction or preprocessor directive. Subtag of
  /// [meta](#highlight.tags.meta)).
  processingInstruction: t(meta),

  /// [Modifier](#highlight.Tag^defineModifier) that indicates that a
  /// given element is being defined. Expected to be used with the
  /// various [name](#highlight.tags.name) tags.
  definition: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) that indicates that
  /// something is constant. Mostly expected to be used with
  /// [variable names](#highlight.tags.variableName).
  constant: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) used to indicate that a
  /// [variable name](#highlight.tags.variableName) is being called or
  /// being defined as a function.
  function: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) that can be applied to
  /// [names](#highlight.tags.name) to indicate that they belong to
  /// the standard environment.
  standard: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) that indicates a given
  /// [names](#highlight.tags.name) is local to some scope.
  local: Tag.defineModifier(),

  /// A generic variant [modifier](#highlight.Tag^defineModifier) that
  /// can be used to tag language-specific alternative variants of
  /// some common tag. It is recommended for themes to define special
  /// forms of at least the [string](#highlight.tags.string) and
  /// [variable name](#highlight.tags.variableName) tags, since those
  /// come up a lot.
  special: Tag.defineModifier()
}

/// A default highlight style (works well with light themes).
export const defaultHighlightStyle = HighlightStyle.define(
  {tag: tags.deleted,
   textDecoration: "line-through"},
  {tag: [tags.inserted, tags.link],
   textDecoration: "underline"},
  {tag: tags.heading,
   textDecoration: "underline",
   fontWeight: "bold"},
  {tag: tags.emphasis,
   fontStyle: "italic"},
  {tag: tags.strong,
   fontWeight: "bold"},
  {tag: tags.keyword,
   color: "#708"},
  {tag: [tags.atom, tags.bool, tags.url],
   color: "#219"},
  {tag: tags.number,
   color: "#164"},
  {tag: tags.string,
   color: "#a11"},
  {tag: [tags.regexp, tags.escape, tags.special(tags.string)],
   color: "#e40"},
  {tag: tags.definition(tags.variableName),
   color: "#00f"},
  {tag: tags.typeName,
   color: "#085"},
  {tag: tags.className,
   color: "#167"},
  {tag: tags.special(tags.variableName),
   color: "#256"},
  {tag: tags.definition(tags.propertyName),
   color: "#00c"},
  {tag: tags.comment,
   color: "#940"},
  {tag: tags.meta,
   color: "#555"},
  {tag: tags.invalid,
   color: "#f00"}
)
