import {EditorState} from "./state"
import {Transaction} from "./transaction"
import {Extension, ExtensionGroup} from "../../extension/src/extension"
import {Tree} from "lezer-tree"

export const extendState = new ExtensionGroup<EditorState>(state => state.values)

export const stateField = extendState.behavior<StateField<any>>({static: true})

export const allowMultipleSelections = extendState.behavior<boolean, boolean>({
  combine: values => values.some(v => v),
  static: true
})

/// Parameters passed when creating a
/// [`StateField`](#state.StateField).
export interface StateFieldSpec<Value> {
  /// Creates the initial value for the field.
  init: (state: EditorState) => Value
  /// Compute a new value from the previous value and a
  /// [transaction](#state.Transaction).
  apply: (tr: Transaction, value: Value, newState: EditorState) => Value
}

/// Fields can store additional information in an editor state.
export class StateField<Value> {
  /// The extension that can be used to
  /// [attach](#state.EditorStateConfig.extensions) this field to a
  /// state.
  readonly extension: Extension

  /// @internal
  readonly id = extendState.storageID()
  /// @internal
  readonly init: (state: EditorState) => Value
  /// @internal
  readonly apply: (tr: Transaction, value: Value, state: EditorState) => Value

  /// Declare a new field. The field instance is used as the
  /// [key](#state.EditorState.field) when retrieving the field's value
  /// from a state.
  constructor(spec: StateFieldSpec<Value>) {
    this.init = spec.init
    this.apply = spec.apply
    this.extension = stateField(this)
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
}
