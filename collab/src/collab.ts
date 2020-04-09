import {Facet, Change, StateField, Annotation, EditorState, StateEffect, Transaction,
        combineConfig, Extension} from "@codemirror/next/state"

/// An update can either be a [change](#state.Change) or an
/// [effect](#state.StateEffect). In each update object, exactly one
/// of these will be `undefined`. When you didn't configure your
/// collab extension with a
/// [`sharedEffects`](#collab.CollabOptions.sharedEffects) option, all
/// updates produced by the extension will have the `change` property
/// set.
export type Update = {
  change?: Change,
  effect?: StateEffect<any>
}

class LocalUpdate implements Update {
  constructor(
    readonly origin: Transaction,
    readonly change?: Change,
    readonly inverted?: Change,
    readonly effect?: StateEffect<any>
  ) {}
}

// Undo a given set of updates, apply a set of other updates, and then
// redo them.
function rebaseUpdates(updates: readonly LocalUpdate[], over: readonly Update[], tr: Transaction) {
  for (let i = updates.length - 1; i >= 0; i--) {
    let update = updates[i]
    if (update.change) tr.changeNoFilter(update.inverted!)
  }
  let mapFrom = tr.changes.length
  for (let update of over) {
    if (update.change) tr.changeNoFilter(update.change)
    else tr.effect(update.effect!)
  }

  let result = []
  for (let update of updates) {
    let mapping = tr.changes.partialMapping(mapFrom)
    if (update.change) {
      let mapped = update.change.map(mapping)
      mapFrom--
      if (mapped) {
        result.push(new LocalUpdate(update.origin, mapped, mapped.invert(tr.doc)))
        tr.changeNoFilter(mapped, mapFrom)
      }
    } else {
      let mapped = update.effect!.map(mapping)
      if (mapped) {
        tr.effect(mapped)
        result.push(new LocalUpdate(update.origin, undefined, undefined, mapped))
      }
    }
  }
  return result
}

// This state field accumulates updates that have to be sent to the
// central authority in the collaborating group and makes it possible
// to integrate updates made by peers into our local document. It is
// defined by the plugin, and will be available as the `collab` field
// in the resulting editor state.
class CollabState {
  constructor(
    // The version number of the last update received from the central
    // authority. Starts at 0 or the value of the `version` property
    // in the option object, for the editor's value when the option
    // was enabled.
    readonly version: number,
    // The local updates that havent been successfully sent to the
    // server yet.
    readonly unconfirmed: readonly LocalUpdate[]) {}
}

/// Configuration passed to [`collab`](#collab.collab).
export type CollabConfig = {
  /// The starting document version. Will default to 0.
  startVersion?: number,
  /// This client's identifying [ID](#collab.getClientID). Will be a
  /// randomly generated string if not provided.
  clientID?: string,
  /// It is possible to share information other than document changes
  /// through this extension. If you provide this option, your
  /// function will be called on each transaction, and the effects it
  /// returns will be sent to the server, much like changes are. Such
  /// effects are automatically remapped when conflicting remote
  /// changes come in.
  sharedEffects?: (tr: Transaction) => readonly StateEffect<any>[]
}

type FullConfig = {startVersion: number, clientID: string, sharedEffects: CollabConfig["sharedEffects"] | null}

const collabConfig = Facet.define<CollabConfig & {generatedID: string}, FullConfig>({
  combine(configs: readonly (CollabConfig & {generatedID: string})[]) {
    let combined = combineConfig<FullConfig>(configs, {startVersion: 0, clientID: "", sharedEffects: null})
    return {startVersion: combined.startVersion,
            clientID: combined.clientID || (configs.length && configs[0].generatedID) || "",
            sharedEffects: combined.sharedEffects}
  }
})

const collabReceive = Annotation.define<CollabState>()

const collabField = StateField.define({
  create(state) {
    return new CollabState(state.facet(collabConfig).startVersion, [])
  },

  update(collab: CollabState, tr: Transaction) {
    let isSync = tr.annotation(collabReceive)
    if (isSync) return isSync
    let updates = tr.changes.changes.map((ch, i) => new LocalUpdate(tr, ch, ch.invert(i ? tr.docs[i - 1] : tr.startState.doc)))
    let {sharedEffects} = tr.startState.facet(collabConfig)
    if (sharedEffects) for (let effect of sharedEffects(tr))
      updates.push(new LocalUpdate(tr, undefined, undefined, effect))
    if (updates.length) return new CollabState(collab.version, collab.unconfirmed.concat(updates))
    return collab
  }
})

/// Create an instance of the collaborative editing plugin.
export function collab(config: CollabConfig = {}): Extension {
  return [
    collabField,
    collabConfig.of({startVersion: config.startVersion,
                     clientID: config.clientID,
                     sharedEffects: config.sharedEffects,
                     generatedID: Math.floor(Math.random() * 0xFFFFFFFF).toString(16)})
  ]
}

// Snuck out for testing purposes here.
;(collab as any).rebase = rebaseUpdates

/// Create a transaction that represents a set of new updates received
/// from the authority. Applying this transaction moves the state
/// forward to adjust to the authority's view of the document.
export function receiveUpdates(state: EditorState, updates: readonly Update[], ownUpdateCount: number) {
  // Pushes a set of updates (received from the central authority)
  // into the editor state (which should have the collab plugin
  // enabled). Will recognize its own updates, and confirm unconfirmed
  // updates as appropriate. Remaining unconfirmed updates will be
  // rebased over remote changes.
  let collabState = state.field(collabField)
  let version = collabState.version + updates.length

  let unconfirmed = collabState.unconfirmed.slice(ownUpdateCount)
  if (ownUpdateCount) updates = updates.slice(ownUpdateCount)

  // If all updates originated with us, we're done.
  if (!updates.length)
    return state.t().annotate(collabReceive, new CollabState(version, unconfirmed))

  let nUnconfirmed = unconfirmed.length
  let tr = state.t()
  if (nUnconfirmed) {
    let interference = checkInterference(unconfirmed, updates)
    unconfirmed = rebaseUpdates(unconfirmed, updates, tr)
    // If the changes don't occur near each other, we can dispatch a
    // simplified transaction that just applies the mapped remote
    // changes, without rebasing.
    if (!interference) {
      let newTr = state.t(), changeI = unconfirmed.reduce((n, u) => n + (u.change ? 1 : 0), 0)
      for (let update of updates) {
        if (update.change) {
          newTr.changeNoFilter(update.change.map(tr.changes.partialMapping(changeI, 0))!)
          changeI++
        } else {
          newTr.effect(update.effect!.map(tr.changes.partialMapping(changeI, 0))!)
        }
      }
      tr = newTr
    }
  } else {
    for (let update of updates) {
      if (update.change) tr.changeNoFilter(update.change)
      else tr.effect(update.effect!)
    }
    unconfirmed = []
  }

  return tr.annotate(Transaction.addToHistory, false)
    .annotate(collabReceive, new CollabState(version, unconfirmed))
    .annotate(Transaction.rebasedChanges, nUnconfirmed)
}

function checkInterference(unconfirmed: readonly LocalUpdate[], remote: readonly Update[]) {
  // Map the extent of all changes back to the original document
  // coordinate space, and check for overlap.
  let localTouched: number[] = []
  for (let i = 0; i < unconfirmed.length; i++) {
    let {change} = unconfirmed[i]
    if (!change) continue
    let {from, to} = change
    for (let j = i - 1; j >= 0; j--) {
      let other = unconfirmed[j].inverted
      if (other) { from = other.mapPos(from, -1); to = other.mapPos(to, 1) }
    }
    localTouched.push(from, to)
  }
  for (let i = 0; i < remote.length; i++) {
    let {change} = remote[i]
    if (!change) continue
    let {from, to} = change
    for (let j = i - 1; j >= 0; j--) {
      let inv = remote[j].change?.invertedDesc
      if (inv) { from = inv.mapPos(from, -1); to = inv.mapPos(to, 1) }
    }
    for (let j = 0; j < localTouched.length; j += 2)
      if (to >= localTouched[j] && from <= localTouched[j + 1])
        return true
  }
  return false
}

/// Returns the set of locally made updates that still have to be sent
/// to the authority. The returned objects will also have an `origin`
/// property that points at the transaction that created them. This
/// may be useful if you want to send along metadata like timestamps.
/// (But note that the updates may have been mapped in the meantime,
/// whereas the transaction is just the original transaction that
/// created them.)
export function sendableUpdates(state: EditorState): readonly (Update & {origin: Transaction})[] {
  return state.field(collabField).unconfirmed
}

/// Get the version up to which the collab plugin has synced with the
/// central authority.
export function getSyncedVersion(state: EditorState) {
  return state.field(collabField).version
}

/// Get this editor's collaborative editing client ID.
export function getClientID(state: EditorState) {
  return state.facet(collabConfig).clientID
}
