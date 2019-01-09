import {EditorState, StateField} from "./state"

type A<T> = ReadonlyArray<T>

// Priorities for overriding the ordering of extensions and behaviors.
export enum Priority { fallback = -1, base = 0, extend = 1, override = 2 }

const noPriority = -2 as Priority

const noDefault = {} as any

const none = [] as any

// A behavior is a type of value that can be associated with an editor
// state. It is used to configure the state, for example by
// associating helper functions with it (see `Behavior.indentation`)
// or configuring the way it behaves (see
// `Behavior.allowMultipleSelections`).
export interface Behavior<Value, Target> {
  (value: Value, priority?: Priority): Extender<Target>
}

function defineBehavior<Value, Target>(unique: boolean): Behavior<Value, Target> {
  let behavior = function(value: Value, priority: Priority = noPriority): Extender<Target> {
    return new Extender(null, behavior, value, priority)
  }
  ;(behavior as any).unique = unique
  return behavior
}

export const Behavior = {
  define<Value>({unique = false}: {unique?: boolean} = {}) {
    return defineBehavior<Value, EditorState>(unique)
  },

  defineExtension<Spec>(instantiate: (spec: Spec) => A<Extender<EditorState>>, defaultSpec = noDefault) {
    return defineExtension<Spec, EditorState>(instantiate, null, defaultSpec)
  },

  defineUniqueExtension<Spec>(instantiate: (specs: A<Spec>) => A<Extender<EditorState>>, defaultSpec: Spec = noDefault) {
    return defineExtension<Spec, EditorState>(null, instantiate, defaultSpec)
  },

  stateField: defineBehavior<StateField<any>, EditorState>(false),
  allowMultipleSelections: defineBehavior<boolean, EditorState>(false),
  indentation: defineBehavior<(state: EditorState, pos: number) => number, EditorState>(false)
}

// An extension is a piece of functionality that can be added to a
// state. It works by pulling in one or more other extensions or
// behaviors. Extensions are configured by values of the `Spec` type,
// and come in two variants: unique extensions 'centralize' their
// behavior, by taking all specs that were given for them in a state,
// and computing a set of extenders from that. This is appropriate for
// extensions like the undo history, which should only be activated
// once per state. Non-unique extensions compute one set of extenders
// per use, which has the advantage that specs do not have to be
// merged and each instance has its own position in the ordering of
// extensions for the state (which can be useful for things like
// keymaps).
export interface Extension<Spec, Target> {
  (spec?: Spec, priority?: Priority): Extender<Target>
}

interface ExtData<Spec, Target> {
  instantiate: ((spec: Spec) => A<Extender<Target>>) | null
  instantiateUnique: ((specs: A<Spec>) => A<Extender<Target>>) | null
  knownSubs: Extension<any, any>[]
}

function defineExtension<Spec, Target>(instantiate: ((spec: Spec) => A<Extender<Target>>) | null,
                                       instantiateUnique: ((specs: A<Spec>) => A<Extender<Target>>) | null,
                                       defaultSpec: Spec): Extension<Spec, Target> {
  let ext = function(spec: Spec = defaultSpec, priority: Priority = noPriority): Extender<Target> {
    if (spec == noDefault) throw new RangeError("This extension has no default spec")
    return new Extender(ext, null, spec, priority)
  }
  let data = ext as any as ExtData<Spec, Target>
  data.instantiate = instantiate
  data.instantiateUnique = instantiateUnique
  data.knownSubs = []
  return ext
}

// Known extensions included from this one. This is filled
// dynamically when initializing the extension, to avoid having to
// bother users with specifying them in advance. If dependency
// resolution goes wrong because of missing information here, it is
// simply started over.
function hasSub(extension: Extension<any, any>, sub: Extension<any, any>): boolean {
  for (let known of (extension as any as ExtData<any, any>).knownSubs)
    if (known == sub || hasSub(known, sub)) return true
  return false
}

function resolveExtension<Target>(extension: Extension<any, Target>, extenders: Extender<Target>[]) {
  // Replace all instances of this extension in extenders with the
  // extenders that they produce.
  let data = extension as any as ExtData<any, Target>
  if (data.instantiateUnique) {
    // For unique extensions, that means collecting the specs and
    // replacing the first instance of the extension with the result
    // of applying instantiateUnique to them, and removing all other
    // instances.
    let ours: Extender<Target>[] = []
    for (let ext of extenders) if (ext.extension == extension) ext.collect(ours)
    let specs = ours.map(s => s.value), first = true
    for (let i = 0; i < extenders.length; i++) if (extenders[i].extension == extension) {
      let sub = first ? subs(data, data.instantiateUnique(specs), extenders[i].priority) : none
      extenders.splice(i, 1, ...sub)
      first = false
      i += sub.length - 1
    }
  } else {
    // For non-unique extensions, each instance is replaced by its
    // sub-extensions separately.
    for (let i = 0; i < extenders.length; i++) if (extenders[i].extension == extension) {
      let ext = extenders[i]
      let sub = subs(data, data.instantiate!(ext.value), ext.priority)
      extenders.splice(i, 1, ...sub)
      i += sub.length - 1
    }
  }
}

// Process a set of sub-extensions, making sure they are registered
// in `this.knownSubs` and filling in any non-specified priorities.
function subs(extension: ExtData<any, any>, extenders: A<Extender<any>>, priority: Priority) {
  for (let ext of extenders)
    if (ext.extension && extension.knownSubs.indexOf(ext.extension) < 0)
      extension.knownSubs.push(ext.extension)
  return extenders.map(e => e.fillPriority(priority))
}

// An extender specifies a behavior or extension that should be
// present in a state. They are both passed directly to
// `EditorState.create` though the extensions option and returned by
// extensions.
export class Extender<Target> {
  // @internal
  constructor(
    // Non-null if this is an instance of an extension.
    // Exactly one of this or behavior will be non-null in any given
    // instance. @internal
    public extension: Extension<any, Target> | null,
    // Non-null if this is an instance of a behavior. @internal
    public behavior: Behavior<any, Target> | null,
    // The extension spec or behavior value. @internal
    public value: any,
    // The priority assigned to this extender. @internal
    public priority: Priority
  ) {}

  // @internal
  fillPriority(priority: Priority): Extender<Target> {
    return this.priority == noPriority ? new Extender(this.extension, this.behavior, this.value, priority) : this
  }

  // Insert this extender in an array of extenders so that it appears
  // after any already-present extenders with the same or lower
  // priority, but before any extenders with higher priority.
  // @internal
  collect(array: Extender<Target>[]) {
    let i = 0
    while (i < array.length && array[i].priority >= this.priority) i++
    array.splice(i, 0, this)
  }
}

// An instance of this is part of EditorState and stores the behaviors
// provided for the state.
export class BehaviorStore<Target> {
  behaviors: Behavior<any, Target>[] = []
  values: any[][] = []

  get<Value>(behavior: Behavior<Value, Target>): Value[] {
    let found = this.behaviors.indexOf(behavior)
    return found < 0 ? none : this.values[found]
  }

  // Resolve an array of extenders by expanding all extensions until
  // only behaviors are left, and then collecting the behaviors into
  // arrays of values, preserving priority ordering throughout.
  static resolve<Target>(extenders: A<Extender<Target>>): BehaviorStore<Target> {
    let pending: Extender<Target>[] = extenders.slice().map(ext => ext.fillPriority(Priority.base))
    // This does a crude topological ordering to resolve behaviors
    // top-to-bottom in the dependency ordering. If there are no
    // cyclic dependencies, we can always find a behavior in the top
    // `pending` array that isn't a dependency of any unresolved
    // behavior, and thus find and order all its specs in order to
    // resolve them.
    for (let resolved: Extension<any, Target>[] = [];;) {
      let top = findTopExtensionType(pending)
      if (!top) break // Only behaviors left
      // Prematurely evaluated a behavior type because of missing
      // sub-behavior information -- start over, in the assumption
      // that newly gathered information will make the next attempt
      // more successful.
      if (resolved.indexOf(top) > -1) return this.resolve(extenders)
      resolved.push(top)
      resolveExtension(top, pending)
    }
    // Collect the behavior values.
    let store = new BehaviorStore
    for (let ext of pending) {
      let behavior = ext.behavior!
      if (store.behaviors.indexOf(behavior) > -1) continue // Already collected
      let values: Extender<Target>[] = []
      for (let e of pending) if (e.behavior == behavior) e.collect(values)
      if ((behavior as any).unique && values.length != 1)
        throw new RangeError("Multiple instances of a unique behavior found")
      store.behaviors.push(behavior)
      store.values.push(values.map(v => v.value))
    }
    return store
  }
}

// Find the extension type that must be resolved next, meaning it is
// not a (transitive) sub-extension of any other extensions that are
// still in extenders.
function findTopExtensionType<Target>(extenders: Extender<Target>[]): Extension<any, Target> | null {
  let foundExtension = false
  for (let ext of extenders) if (ext.extension) {
    foundExtension = true
    if (!extenders.some(b => b.extension ? hasSub(b.extension, ext.extension!) : false))
      return ext.extension
  }
  if (foundExtension) throw new RangeError("Sub-extension cycle in extensions")
  return null
}

// Utility function for combining behaviors to fill in a config
// object from an array of provided configs. Will, by default, error
// when a field gets two values that aren't ===-equal, but you can
// provide combine functions per field to do something else.
export function combineConfig<Config>(configs: A<Config>,
                                      combine: {[key: string]: (first: any, second: any) => any} = {},
                                      defaults?: Config): Config {
  let result: any = {}
  for (let config of configs) for (let key of Object.keys(config)) {
    let value = (config as any)[key], current = result[key]
    if (current === undefined) result[key] = value
    else if (current === value || value === undefined) {} // No conflict
    else if (Object.hasOwnProperty.call(combine, key)) result[key] = combine[key](current, value)
    else throw new Error("Config merge conflict for field " + key)
  }
  if (defaults) for (let key in defaults)
    if (result[key] === undefined) result[key] = (defaults as any)[key]
  return result
}
