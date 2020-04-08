import {Facet, Change, StateField, Annotation, EditorState, Transaction} from "@codemirror/next/state"

class Rebaseable { // FIXME store metadata with these?
  constructor(readonly forward: Change, readonly backward: Change) {}
}

// Undo a given set of changes, apply a set of other changes, and then
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
    // The local changes that havent been successfully sent to the
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
    // FIXME does this have to be so complicated? (The issue this
    // addresses is that we don't want to regenerate the client id on
    // reconfiguration.)
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
  return [
    collabField,
    collabConfig.of({startVersion: config.startVersion,
                     clientID: config.clientID,
                     generatedID: mkID()})
  ]
}

/// Create a transaction that represents a set of new changes received
/// from the authority. Applying this transaction moves the state
/// forward to adjust to the authority's view of the document.
export function receiveChanges(state: EditorState, changes: readonly Change[], clientIDs: readonly string[]) {
  // Pushes a set of changes (received from the central authority)
  // into the editor state (which should have the collab plugin
  // enabled). Will recognize its own changes, and confirm unconfirmed
  // changes as appropriate. Remaining unconfirmed changes will be
  // rebased over remote changes.
  let collabState = state.field(collabField)
  let version = collabState.version + changes.length
  let ourID = state.facet(collabConfig).clientID

  // Find out which prefix of the changes originated with us
  let ours = 0
  while (ours < clientIDs.length && clientIDs[ours] == ourID) ++ours
  let unconfirmed = collabState.unconfirmed.slice(ours)
  changes = ours ? changes.slice(ours) : changes

  // If all changes originated with us, we're done.
  if (!changes.length)
    return state.t().annotate(collabReceive, new CollabState(version, unconfirmed))

  let nUnconfirmed = unconfirmed.length
  let tr = state.t()
  if (nUnconfirmed) {
    let interference = checkInterference(unconfirmed, changes)
    unconfirmed = rebaseChanges(unconfirmed, changes, tr)
    // If the changes don't occur near each other, we can dispatch a
    // simplified transaction that just applies the mapped remote
    // changes, without rebasing.
    if (!interference) {
      let newTr = state.t()
      for (let i = 0; i < changes.length; i++)
        newTr.changeNoFilter(changes[i].map(tr.changes.partialMapping(unconfirmed.length + i, 0))!)
      tr = newTr
    }
  } else {
    for (let change of changes) tr.changeNoFilter(change)
    unconfirmed = []
  }

  return tr.annotate(Transaction.addToHistory, false)
    .annotate(collabReceive, new CollabState(version, unconfirmed))
    .annotate(Transaction.rebasedChanges, nUnconfirmed)
}

function checkInterference(unconfirmed: readonly Rebaseable[], remote: readonly Change[]) {
  // Map the extent of all changes back to the original document
  // coordinate space, and check for overlap.
  let localTouched: number[] = []
  for (let i = 0; i < unconfirmed.length; i++) {
    let {from, to} = unconfirmed[i].forward
    for (let j = i - 1; j >= 0; j--) {
      from = unconfirmed[j].backward.mapPos(from, -1)
      to = unconfirmed[j].backward.mapPos(to, 1)
    }
    localTouched.push(from, to)
  }
  for (let i = 0; i < remote.length; i++) {
    let {from, to} = remote[i]
    for (let j = i - 1; j >= 0; j--) {
      let inv = remote[j].invertedDesc
      from = inv.mapPos(from, -1)
      to = inv.mapPos(to, 1)
    }
    for (let j = 0; j < localTouched.length; j += 2)
      if (to >= localTouched[j] && from <= localTouched[j + 1])
        return true
  }
  return false
}

/// Returns the set of locally made changes that still have to be sent
/// to the authority.
export function sendableChanges(state: EditorState) {
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
