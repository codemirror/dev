import {Facet, ChangeSet, ChangeDesc, StateField, Annotation, EditorState, StateEffect, Transaction,
        combineConfig, Extension} from "@codemirror/next/state"

/// An update is a set of changes and effects. There'll only ever be
/// effects in these When you configured your collab extension with a
/// [`sharedEffects`](#collab.CollabOptions.sharedEffects) option.
export interface Update {
  changes: ChangeSet,
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
    return state.tr({annotations: [collabReceive.of(new CollabState(version, unconfirmed))]})

  let changes: ChangeSet | undefined = undefined, effects = []
  if (unconfirmed.length) {
    let changes = updates[0].changes
    for (let i = 1; i < updates.length; i++) {
      changes = changes.compose(updates[i].changes)
    }
    let mapping: ChangeDesc[] = [changes]
    for (let update of unconfirmed)
      mapping.push(mapping[mapping.length - 1].mapDesc(update.changes, true))
    unconfirmed = unconfirmed.map((update, i) =>
                                  new LocalUpdate(update.origin, update.changes.map(mapping[i]),
                                                  update.effects.map(e => e.map(mapping[i + 1]))))
    
  }
    for (let i = 0; i < mapping.lenA)
      unconfirmed.push(
    
    for (let local of unconfirmed) {
      let {changes, effects} = local
      for (let remote of updates) {
        changes = changes
      }
    }
    unconfirmed = unconfirmed
    let interference = checkInterference(unconfirmed, updates)
    
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
