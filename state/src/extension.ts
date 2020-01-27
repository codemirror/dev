import {EditorState} from "./state"
import {Transaction} from "./transaction"
import {Facet} from "./facet"
import {Tree, NodeType, NodeProp} from "lezer-tree"

/// Subtype of [`Command`](#view.Command) that doesn't require access
/// to the actual editor view. Mostly useful to define commands that
/// can be run and tested outside of a browser environment.
export type StateCommand = (target: {state: EditorState, dispatch: (transaction: Transaction) => void}) => boolean

export const allowMultipleSelections = Facet.define<boolean, boolean>({
  combine: values => values.some(v => v),
  static: true
})

let annotationID = 0

/// Annotations are tagged values that are used to add metadata to
/// transactions in an extensible way.
export class Annotation<T> {
  /// @internal
  id = annotationID++

  private constructor() {}

  /// Define a new type of annotation.
  static define<T>() { return new Annotation<T>() }
}

/// A node prop that can be stored on a grammar's top node to
/// associate information with the language. Different extension might
/// use different properties from this object (which they typically
/// export as an interface).
export const languageData = new NodeProp<{}>()

/// Syntax [parsing services](#state.EditorState^syntax) must provide
/// this interface.
export interface Syntax {
  /// Read the current syntax tree from a state. This may return an
  /// incomplete tree.
  getTree(state: EditorState): Tree

  /// Get the position up to which the current document has been
  /// parsed.
  parsePos(state: EditorState): number

  /// Get a tree that covers the document at least up to `upto`. If
  /// that involves more than `timeout` milliseconds of work, return
  /// null instead. Don't call this as a matter of course in, for
  /// example, state updates or decorating functions, since it'll make
  /// the editor unresponsive. Calling it in response to a specific
  /// user command can be appropriate.
  ensureTree(state: EditorState, upto: number, timeout?: number): Tree | null

  /// The node type at the root of trees produced by this syntax.
  docNodeType: NodeType

  /// Return the language data object for the given position. This'll
  /// usually be the be the data for the grammar's top node, but with
  /// nested grammars it may be the data of some nested grammar.
  languageDataAt<Interface = any>(state: EditorState, pos: number): Interface
}

// FIXME add a view plugin that schedules background parsing

// FIXME add a way to be notified when the document is fully parsed
