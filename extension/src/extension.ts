const none = [] as any

const enum Kind { BEHAVIOR, MULTI, UNIQUE }

export class Extension {
  // @internal
  constructor(/* @internal */ public kind: Kind,
              /* @internal */ public id: any,
              /* @internal */ public value: any,
              /* @internal */ public priority: number = -2) {}

  private setPrio(priority: number): this {
    // Crude casting because TypeScript doesn't understand new this.constructor
    return new (this.constructor as any)(this.kind, this.id, this.value, priority) as this
  }
  fallback() { return this.setPrio(-1) }
  extend() { return this.setPrio(1) }
  override() { return this.setPrio(2) }

  // @internal
  flatten(priority: number, target: Extension[] = []) {
    if (this.kind == Kind.MULTI) for (let ext of this.value as Extension[]) ext.flatten(this.priority > -2 ? this.priority : priority, target)
    else target.push(this.priority > -2 ? this : this.setPrio(priority))
    return target
  }

  // Insert this extension in an array of extensions so that it
  // appears after any already-present extensions with the same or
  // lower priority, but before any extensions with higher priority.
  // @internal
  collect(array: Extension[]) {
    let i = 0
    while (i < array.length && array[i].priority >= this.priority) i++
    array.splice(i, 0, this)
  }

  // Define a type of behavior, which is the thing that extensions
  // eventually resolve to. Each behavior can have an ordered sequence
  // of values associated with it. An `Extension` can be seen as a
  // tree of sub-extensions with behaviors as leaves.
  static defineBehavior<Value>() {
    let behavior = (value: Value) => new this(Kind.BEHAVIOR, behavior, value)
    return behavior
  }

  static unique<Spec>(instantiate: (specs: Spec[]) => Extension, defaultSpec?: Spec): (spec?: Spec) => Extension {
    const type = new UniqueExtensionType(instantiate)
    return (spec: Spec | undefined = defaultSpec) => {
      if (spec === undefined) throw new RangeError("This extension has no default spec")
      return new this(Kind.UNIQUE, type, spec)
    }
  }

  static all(...extensions: Extension[]) {
    return new this(Kind.MULTI, null, extensions)
  }

  // Resolve an array of extenders by expanding all extensions until
  // only behaviors are left, and then collecting the behaviors into
  // arrays of values, preserving priority ordering throughout.
  static resolve(extensions: ReadonlyArray<Extension>): BehaviorStore {
    let pending: Extension[] = new this(Kind.MULTI, null, extensions).flatten(0)
    // This does a crude topological ordering to resolve behaviors
    // top-to-bottom in the dependency ordering. If there are no
    // cyclic dependencies, we can always find a behavior in the top
    // `pending` array that isn't a dependency of any unresolved
    // behavior, and thus find and order all its specs in order to
    // resolve them.
    for (let resolved: UniqueExtensionType[] = [];;) {
      let top = findTopUnique(pending, this)
      if (!top) break // Only behaviors left
      // Prematurely evaluated a behavior type because of missing
      // sub-behavior information -- start over, in the assumption
      // that newly gathered information will make the next attempt
      // more successful.
      if (resolved.indexOf(top) > -1) return this.resolve(extensions)
      top.resolve(pending)
      resolved.push(top)
    }
    // Collect the behavior values.
    let store = new BehaviorStore
    for (let ext of pending) {
      if (!(ext instanceof this)) {
        // Collect extensions of the wrong type into store.foreign
        store.foreign.push(ext)
        continue
      }
      if (store.behaviors.indexOf(ext.id) > -1) continue // Already collected
      let values: Extension[] = []
      for (let e of pending) if (e.id == ext.id) e.collect(values)
      store.behaviors.push(ext.id)
      store.values.push(values.map(v => v.value))
    }
    return store
  }
}

class UniqueExtensionType {
  knownSubs: UniqueExtensionType[] = []

  constructor(public instantiate: (...specs: any[]) => Extension) {}

  hasSub(type: UniqueExtensionType): boolean {
    for (let known of this.knownSubs)
      if (known == type || known.hasSub(type)) return true
    return false
  }

  resolve(extensions: Extension[]) {
    // Replace all instances of this type in extneions with the
    // sub-extensions that instantiating produces.
    let ours: Extension[] = []
    for (let ext of extensions) if (ext.id == this) ext.collect(ours)
    let first = true
    for (let i = 0; i < extensions.length; i++) {
      let ext = extensions[i]
      if (ext.id != this) continue
      let sub = first ? this.subs(ours.map(s => s.value), ext.priority) : none
      extensions.splice(i, 1, ...sub)
      first = false
      i += sub.length - 1
    }
  }

  subs(specs: any[], priority: number) {
    let subs = this.instantiate(specs).flatten(priority)
    for (let sub of subs)
      if (sub.kind == Kind.UNIQUE && this.knownSubs.indexOf(sub.id) == -1) this.knownSubs.push(sub.id)
    return subs
  }
}

// An instance of this is part of EditorState and stores the behaviors
// provided for the state.
export class BehaviorStore {
  // @internal
  behaviors: any[] = []
  // @internal
  values: any[][] = []
  // Any extensions that weren't an instance of the given type when
  // resolving.
  foreign: Extension[] = []

  get<Value>(behavior: (v: Value) => Extension): Value[] {
    let found = this.behaviors.indexOf(behavior)
    return found < 0 ? none : this.values[found]
  }
}

// Find the extension type that must be resolved next, meaning it is
// not a (transitive) sub-extension of any other extensions that are
// still in extenders.
function findTopUnique(extensions: Extension[], type: typeof Extension): UniqueExtensionType | null {
  let foundUnique = false
  for (let ext of extensions) if (ext.kind == Kind.UNIQUE && ext instanceof type) {
    foundUnique = true
    if (!extensions.some(e => e.kind == Kind.UNIQUE && (e.id as UniqueExtensionType).hasSub(ext.id)))
      return ext.id
  }
  if (foundUnique) throw new RangeError("Sub-extension cycle in unique extensions")
  return null
}

type NonUndefined<T> = T extends undefined ? never : T

// Utility function for combining behaviors to fill in a config
// object from an array of provided configs. Will, by default, error
// when a field gets two values that aren't ===-equal, but you can
// provide combine functions per field to do something else.
export function combineConfig<Config>(configs: ReadonlyArray<Partial<Config>>,
                                      defaults: Config,
                                      combine: {[P in keyof Config]?: (first: NonUndefined<Config[P]>, second: NonUndefined<Config[P]>) => NonUndefined<Config[P]>} = {}): Config {
  let result: Partial<Config> = {}
  for (let config of configs) for (let key of Object.keys(config) as (keyof Config)[]) {
    let value = config[key], current = result[key]
    if (current === undefined) result[key] = value
    else if (current === value || value === undefined) {} // No conflict
    else if (Object.hasOwnProperty.call(combine, key)) result[key] = combine[key]!(current as any, value as any)
    else throw new Error("Config merge conflict for field " + key)
  }
  for (let key in defaults)
    if (result[key] === undefined) result[key] = defaults[key]
  return result as any as Config
}
