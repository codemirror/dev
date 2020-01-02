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

/// Annotations are tagged values that are used to add metadata to
/// transactions in an extensible way.
export class Annotation<T> {
  /// @internal
  constructor(/** @internal */ public type: (value: T) => Annotation<T>,
              /** @internal */ public value: T) {}

  /// Define a new type of annotation. Returns a function that you can
  /// call with a content value to create an instance of this type.
  static define<T>(): (value: T) => Annotation<T> {
    return function type(value: T) { return new Annotation<T>(type, value) }
  }
}

/// This is a
/// [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
/// with an additional field that can be used to indicate you are no
/// longer interested in its result. It is used by the editor view's
/// [`waitFor`](#view.EditorView.waitFor) mechanism, which helps deal
/// with partial results (mostly from [`Syntax`](#state.Syntax)
/// queries).
export type CancellablePromise<T> = Promise<T> & {canceled?: boolean}

/// A node prop that can be stored on a grammar's top node to
/// associate information with the language. Different extension might
/// use different properties from this object (which they typically
/// export as an interface).
export const languageData = new NodeProp<{}>()

/// Syntax [parsing services](#state.EditorState^syntax) must provide
/// this interface.
export interface Syntax {
  /// Get a syntax tree covering at least the given range. When that
  /// can't be done quickly enough, `rest` will hold a promise that
  /// you can wait on to get the rest of the tree.
  getTree(state: EditorState, from: number, to: number): {tree: Tree, rest: CancellablePromise<Tree> | null}

  /// Get a syntax tree covering the given range, or null if that
  /// can't be done in reasonable time.
  tryGetTree(state: EditorState, from: number, to: number): Tree | null

  /// Get a syntax tree, preferably covering the given range, but less
  /// is also acceptable.
  getPartialTree(state: EditorState, from: number, to: number): Tree

  /// The node type at the root of trees produced by this syntax.
  docNodeType: NodeType

  /// Return the language data object for the given position. This'll
  /// usually be the be the data for the grammar's top node, but with
  /// nested grammars it may be the data of some nested grammar.
  languageDataAt<Interface = any>(state: EditorState, pos: number): Interface
}
