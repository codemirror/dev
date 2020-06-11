import {Facet, ChangeSet, StateField, Annotation, EditorState, StateEffect, Transaction,
        combineConfig, Extension} from "@codemirror/next/state"

/// An update is a set of changes and effects.
export interface Update {
  /// The changes made by this update.
  changes: ChangeSet,
  /// The effects in this update. There'll only ever be effects here
  /// when you configured your collab extension with a
  /// [`sharedEffects`](#collab.collab^config.sharedEffects) option.
  effects?: readonly StateEffect<any>[]
}

class LocalUpdate implements Update {
  constructor(
    readonly origin: Transaction,
    readonly changes: ChangeSet,
    readonly effects: readonly StateEffect<any>[]
  ) {}
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

type CollabConfig = {
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
    let {sharedEffects} = tr.startState.facet(collabConfig)
    let update = new LocalUpdate(tr, tr.changes, sharedEffects ? sharedEffects(tr) : [])
    if (update.effects.length || !update.changes.empty)
      return new CollabState(collab.version, collab.unconfirmed.concat(update))
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
    return state.update({annotations: [collabReceive.of(new CollabState(version, unconfirmed))]})

  let changes = updates[0].changes, effects = updates[0].effects || []
  for (let i = 1; i < updates.length; i++) {
    let update = updates[i]
    effects = StateEffect.mapEffects(effects, update.changes)
    if (update.effects) effects = effects.concat(update.effects)
    changes = changes.compose(update.changes)
  }
  
  if (unconfirmed.length) {
    let newUnconfirmed = []
    for (let update of unconfirmed) {
      let updateChanges = update.changes.map(changes)
      changes = changes.map(update.changes, true)
      newUnconfirmed.push(new LocalUpdate(update.origin, updateChanges, StateEffect.mapEffects(update.effects, changes)))
    }
    unconfirmed = newUnconfirmed
    effects = StateEffect.mapEffects(effects, unconfirmed.reduce((ch, u) => ch.compose(u.changes),
                                                                 ChangeSet.empty(unconfirmed[0].changes.length)))
  }
  return state.update({
    changes,
    effects,
    annotations: [
      Transaction.addToHistory.of(false),
      collabReceive.of(new CollabState(version, unconfirmed))
    ],
    filter: false
  })
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
