import {EditorState} from "./state"
import {Transaction, TransactionSpec} from "./transaction"
import {Facet} from "./facet"

export const languageData = Facet.define<(state: EditorState, pos: number) => readonly {[name: string]: any}[]>()

/// Subtype of [`Command`](#view.Command) that doesn't require access
/// to the actual editor view. Mostly useful to define commands that
/// can be run and tested outside of a browser environment.
export type StateCommand = (target: {state: EditorState, dispatch: (transaction: Transaction) => void}) => boolean

export const allowMultipleSelections = Facet.define<boolean, boolean>({
  combine: values => values.some(v => v),
  static: true
})

export const lineSeparator = Facet.define<string, string | undefined>({
  combine: values => values.length ? values[0] : undefined,
  static: true
})

export const changeFilter = Facet.define<(tr: Transaction) => boolean | readonly number[]>()

export const transactionFilter = Facet.define<(tr: Transaction) => TransactionSpec | readonly TransactionSpec[]>()

export const transactionExtender =
  Facet.define<(tr: Transaction) => Pick<TransactionSpec, "effects" | "annotations" | "reconfigure">>()
