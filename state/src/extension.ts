import {EditorState, StateField} from "./state"

type A<T> = ReadonlyArray<T>

export enum Priority { fallback = -1, base = 0, extend = 1, override = 2 }

const noPriority = -2 as Priority

const noDefault = {} as any

const none = [] as any

// A behavior is a type of value that can be associated with an editor
// state. It is used to configure the state, for example by
// associating helper functions with it (see `Behavior.indentation`)
// or configuring the way it behaves (see
// `Behavior.allowMultipleSelections`).
export class Behavior<Value> {
  private constructor(public unique: boolean) {}

  static define<Value>({unique = false}: {unique?: boolean} = {}) {
    return new Behavior<Value>(unique)
  }

  use(value: Value, priority: Priority = noPriority): Extender {
    return new Extender(null, this, value, priority)
  }

  get(state: EditorState): Value[] {
    return state.config.behavior.get(this)
  }

  getSingle<Default = undefined>(state: EditorState, defaultValue: Default): Value | Default {
    if (!this.unique) throw new Error("Can only call getSingle on a Behavior with unique=true")
    let all = this.get(state)
    return all.length == 0 ? defaultValue : all[1]
  }

  static stateField = Behavior.define<StateField<any>>()

  static allowMultipleSelections = Behavior.define<boolean>()

  static indentation = Behavior.define<(state: EditorState, pos: number) => number>()
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
export class Extension<Spec> {
  private constructor(private instantiate: ((spec: Spec) => A<Extender>) | null,
                      private instantiateUnique: ((specs: A<Spec>) => A<Extender>) | null,
                      private defaultSpec: Spec) {}

  static define<Spec>(instantiate: (spec: Spec) => A<Extender>, defaultSpec: Spec = noDefault) {
    return new Extension(instantiate, null, defaultSpec)
  }

  static defineUnique<Spec>(instantiate: (specs: A<Spec>) => A<Extender>, defaultSpec: Spec = noDefault) {
    return new Extension(null, instantiate, defaultSpec)
  }

  use(spec: Spec = this.defaultSpec, priority: Priority = noPriority): Extender {
    if (spec == noDefault) throw new RangeError("This extension has no default spec")
    return new Extender(this, null, spec, priority)
  }

  // Known extensions included from this one. This is filled
  // dynamically when initializing the extension, to avoid having to
  // bother users with specifying them in advance. If dependency
  // resolution goes wrong because of missing information here, it is
  // simply started over.
  private knownSub: Extension<any>[] = []

  // @internal
  hasSub(extension: Extension<any>): boolean {
    for (let sub of this.knownSub)
      if (sub == extension || sub.hasSub(extension)) return true
    return false
  }

  // @internal
  resolve(extenders: Extender[]) {
    // Replace all instances of this extension in extenders with the
    // extenders that they produce.
    if (this.instantiateUnique) {
      // For unique extensions, that means collecting the specs and
      // replacing the first instance of the extension with the result
      // of applying this.unique to them, and removing all other
      // instances.
      let ours: Extender[] = []
      for (let ext of extenders) if (ext.extension == this) ext.collect(ours)
      let specs = ours.map(s => s.value as Spec), first = true
      for (let i = 0; i < extenders.length; i++) if (extenders[i].extension == this) {
        let sub = first ? this.subs(this.instantiateUnique(specs), extenders[i].priority) : none
        extenders.splice(i, 1, ...sub)
        first = false
        i += sub.length - 1
      }
    } else {
      // For non-unique extensions, each instance is replaced by its
      // sub-extensions separately.
      for (let i = 0; i < extenders.length; i++) if (extenders[i].extension == this) {
        let ext = extenders[i]
        let sub = this.subs(this.instantiate!(ext.value as Spec), ext.priority)
        extenders.splice(i, 1, ...sub)
        i += sub.length - 1
      }
    }
  }

  private subs(extenders: A<Extender>, priority: Priority) {
    for (let ext of extenders)
      if (ext.extension && this.knownSub.indexOf(ext.extension) < 0)
        this.knownSub.push(ext.extension)
    return extenders.map(e => e.fillPriority(priority))
  }
}

export class Extender {
  // @internal
  constructor(/* @internal */ public extension: Extension<any> | null,
              /* @internal */ public behavior: Behavior<any> | null,
              /* @internal */ public value: any,
              /* @internal */ public priority: Priority) {}

  // @internal
  fillPriority(priority: Priority): Extender {
    return this.priority == noPriority ? new Extender(this.extension, this.behavior, this.value, priority) : this
  }

  // @internal
  collect(array: Extender[]) {
    let i = 0
    while (i < array.length && array[i].priority >= this.priority) i++
    array.splice(i, 0, this)
  }
}

export class BehaviorStore {
  behaviors: Behavior<any>[] = []
  values: any[][] = []

  get<Value>(behavior: Behavior<Value>): Value[] {
    let found = this.behaviors.indexOf(behavior)
    return found < 0 ? none : this.values[found]
  }

  static resolve(extenders: A<Extender>): BehaviorStore {
    let store = new BehaviorStore
    let pending: Extender[] = extenders.slice().map(ext => ext.fillPriority(Priority.base))
    // This does a crude topological ordering to resolve behaviors
    // top-to-bottom in the dependency ordering. If there are no
    // cyclic dependencies, we can always find a behavior in the top
    // `pending` array that isn't a dependency of any unresolved
    // behavior, and thus find and order all its specs in order to
    // resolve them.
    for (let resolved: Extension<any>[] = [];;) {
      let top = findTopExtensionType(pending)
      if (!top) break // Only behaviors left
      // Prematurely evaluated a behavior type because of missing
      // sub-behavior information -- start over, in the assumption
      // that newly gathered information will make the next attempt
      // more successful.
      if (resolved.indexOf(top) > -1) return this.resolve(extenders)
      resolved.push(top)
      top.resolve(pending)
    }
    for (let ext of pending) {
      let behavior = ext.behavior!
      if (store.behaviors.indexOf(behavior) > -1) continue // Already collected
      let values: Extender[] = []
      for (let e of pending) if (e.behavior == behavior) e.collect(values)
      if (behavior.unique && values.length != 1)
        throw new RangeError("Multiple instances of a unique behavior found")
      store.behaviors.push(behavior)
      store.values.push(values.map(v => v.value))
    }
    return store
  }
}

function findTopExtensionType(extenders: Extender[]): Extension<any> | null {
  let foundExtension = false
  for (let ext of extenders) if (ext.extension) {
    foundExtension = true
    if (!extenders.some(b => b.extension ? b.extension.hasSub(ext.extension!) : false))
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
