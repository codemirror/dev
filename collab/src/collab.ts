import {Facet, Change, StateField, Annotation, EditorState, Transaction} from "@codemirror/next/state"

class Rebaseable { // FIXME store metadata with these?
  constructor(readonly forward: Change, readonly backward: Change) {}
}

// Undo a given set of steps, apply a set of other steps, and then
// redo them. Return the mapped set of rebaseable objects.
export function rebaseChanges(changes: readonly Rebaseable[], over: readonly Change[], tr: Transaction) {
  for (let i = changes.length - 1; i >= 0; i--) tr.changeNoFilter(changes[i].backward)
  for (let change of over) tr.changeNoFilter(change)
  let result = [], mapFrom = changes.length
  for (let {forward} of changes) {
    let mapped = forward.map(tr.changes.partialMapping(mapFrom))
    mapFrom--
    if (mapped) {
      result.push(new Rebaseable(mapped, mapped.invert(tr.doc)))
      tr.changeNoFilter(mapped, mapFrom)
    }
  }
  return result
}

// This state field accumulates changes that have to be sent to the
// central authority in the collaborating group and makes it possible
// to integrate changes made by peers into our local document. It is
// defined by the plugin, and will be available as the `collab` field
// in the resulting editor state.
class CollabState {
  constructor(
    // The version number of the last update received from the central
    // authority. Starts at 0 or the value of the `version` property
    // in the option object, for the editor's value when the option
    // was enabled.
    readonly version: number,
    // The local steps that havent been successfully sent to the
    // server yet.
    readonly unconfirmed: readonly Rebaseable[]) {}
}

export type CollabConfig = {
  startVersion?: number,
  clientID?: string
}

function mkID() { return Math.floor(Math.random() * 0xFFFFFFFF).toString(16) }

const defaultClientID = mkID()

const collabConfig = Facet.define<CollabConfig & {generatedID: string}, Required<CollabConfig>>({
  combine(configs: readonly (CollabConfig & {generatedID: string})[]) {
    let version = 0, clientID: string | null = null
    for (let conf of configs) {
      if (conf.startVersion != null) {
        if (version > 0 && version != conf.startVersion) throw new Error("Inconsistent start versions in collab config")
        version = conf.startVersion
      }
      if (conf.clientID != null) {
        if (clientID != null && clientID != conf.clientID) throw new Error("Inconsistent client ids in collab config")
        clientID = conf.clientID
      }
    }
    return {startVersion: version, clientID: clientID || (configs.length && configs[0].generatedID) || defaultClientID }
  }
})

const collabReceive = Annotation.define<CollabState>()

const collabField = StateField.define({
  create(state) {
    return new CollabState(state.facet(collabConfig).startVersion, [])
  },

  update(collab: CollabState, tr: Transaction) {
    let isSync = tr.annotation(collabReceive)
    if (isSync) return isSync // FIXME store whole new state, or derive at update time?
    if (tr.docChanged)
      return new CollabState(collab.version, collab.unconfirmed.concat(unconfirmedFrom(tr)))
    return collab
  }
})

function unconfirmedFrom(tr: Transaction) {
  return tr.changes.changes.map((ch, i) => new Rebaseable(ch, ch.invert(i ? tr.docs[i - 1] : tr.startState.doc)))
}

export function collab(config: CollabConfig = {}) {
  // FIXME include some facet that controls history behavior?
  return [
    collabField,
    collabConfig.of({startVersion: config.startVersion,
                     clientID: config.clientID,
                     generatedID: mkID()})
  ]
}

/// Create a transaction that represents a set of new steps received from
/// the authority. Applying this transaction moves the state forward to
/// adjust to the authority's view of the document.
export function receiveTransaction(state: EditorState, changes: readonly Change[], clientIDs: readonly string[]) {
  // Pushes a set of steps (received from the central authority) into
  // the editor state (which should have the collab plugin enabled).
  // Will recognize its own changes, and confirm unconfirmed steps as
  // appropriate. Remaining unconfirmed steps will be rebased over
  // remote steps.
  let collabState = state.field(collabField)
  let version = collabState.version + changes.length
  let ourID = state.facet(collabConfig).clientID

  // Find out which prefix of the steps originated with us
  let ours = 0
  while (ours < clientIDs.length && clientIDs[ours] == ourID) ++ours
  let unconfirmed = collabState.unconfirmed.slice(ours)
  changes = ours ? changes.slice(ours) : changes

  // If all steps originated with us, we're done.
  if (!changes.length)
    return state.t().annotate(collabReceive, new CollabState(version, unconfirmed))

  let nUnconfirmed = unconfirmed.length
  let tr = state.t()
  if (nUnconfirmed) {
    unconfirmed = rebaseChanges(unconfirmed, changes, tr)
  } else {
    for (let change of changes) tr.changeNoFilter(change)
    unconfirmed = []
  }

  // FIXME notify history/other of rebase shape
  return tr.annotate(Transaction.addToHistory, false).annotate(collabReceive, new CollabState(version, unconfirmed))
}

/// Returns the set of locally made steps that still have to be sent
/// to the authority.
export function sendableSteps(state: EditorState) {
  return state.field(collabField).unconfirmed.map(u => u.forward)
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
