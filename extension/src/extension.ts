/// A slot is tagged value, where its tag determines its role and
/// type. These are used, for example, to allow adding open-ended
/// metadata to transactions.
export class Slot<T = any> {
  /// @internal
  constructor(/** @internal */ public type: SlotType<T>,
              /** @internal */ public value: T) {}

  /// Define a new type of slot. Returns a function that you can call
  /// with a content value to create an instance of this type.
  static define<T>(): SlotType<T> {
    let type: SlotType<T> = (value: T) => new Slot<T>(type, value)
    return type
  }

  /// Retrieve the value of the (first) slot with the given type in an
  /// array of slots, or return undefined when no such slot is found.
  static get<T>(type: SlotType<T>, slots: readonly Slot[]): T | undefined {
    for (let i = slots.length - 1; i >= 0; i--)
      if (slots[i].type == type) return slots[i].value as T
    return undefined
  }
}

/// A slot type is both the key used to identify that type of slot,
/// and a function used to create instances of it.
export type SlotType<T> = (value: T) => Slot<T>

const enum Priority { None = -2, Fallback = -1, Default = 0, Extend = 1, Override = 2 }

const enum Kind { Behavior, Multi, Unique }

/// Behaviors are the way in which CodeMirror is configured. Each
/// behavior type can have zero or more values (of the appropriate
/// type) associated with it by extensions. A behavior type is a
/// function that can be called to create an extension adding that
/// behavior, but also serves as the key that identifies the behavior.
export type Behavior<Value> = (value: Value) => Extension

/// All extensions are associated with an extension type. This is used
/// to distinguish extensions meant for different types of hosts (such
/// as the editor view and state).
export class ExtensionType {
  /// Define a type of behavior. All extensions eventually resolve to
  /// behaviors. Each behavior can have an ordered sequence of values
  /// associated with it. An `Extension` can be seen as a tree of
  /// sub-extensions with behaviors as leaves.
  behavior<Value>(): Behavior<Value> {
    let behavior = (value: Value) => new Extension(Kind.Behavior, behavior, value, this)
    return behavior
  }

  /// Define a unique extension. When resolving extensions, all
  /// instances of a given unique extension are merged before their
  /// content extensions are retrieved. The `instantiate` function
  /// will be called with all the specs (configuration values) passed
  /// to the instances of the unique extension, and should resolve
  /// them to a more concrete extension value (or raise an error if
  /// they conflict).
  unique<Spec>(instantiate: (specs: Spec[]) => Extension, defaultSpec?: Spec): (spec?: Spec) => Extension {
    const type = new UniqueExtensionType(instantiate)
    return (spec: Spec | undefined = defaultSpec) => {
      if (spec === undefined) throw new RangeError("This extension has no default spec")
      return new Extension(Kind.Unique, type, spec, this)
    }
  }

  /// Resolve an array of extensions by expanding all extensions until
  /// only behaviors are left, and then collecting the behaviors into
  /// arrays of values, preserving priority ordering throughout.
  resolve(extensions: readonly Extension[]): BehaviorStore {
    let pending: Extension[] = new Extension(Kind.Multi, null, extensions, this).flatten(Priority.Default)
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
      if (ext.type != this) {
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

/// And extension is a value that describes a way in which something
/// is to be extended. It can be produced by instantiating a behavior,
/// calling unique extension function, or grouping extensions with
/// `Extension.all`.
export class Extension {
  /// @internal
  constructor(
    /// @internal
    readonly kind: Kind,
    /// @internal
    readonly id: any,
    /// @internal
    readonly value: any,
    /// @internal
    readonly type: ExtensionType,
    /// @internal
    readonly priority: number = Priority.None
  ) {}

  private setPrio(priority: Priority) {
    return new Extension(this.kind, this.id, this.value, this.type, priority)
  }
  /// Create a copy of this extension with a priority below the
  /// default priority, which will cause default-priority extensions
  /// to override it even if they are specified later in the extension
  /// ordering.
  fallback() { return this.setPrio(Priority.Fallback) }
  /// Create a copy of this extension with a priority above the
  /// default priority.
  extend() { return this.setPrio(Priority.Extend) }
  /// Create a copy of this extension with a priority above the
  /// default and `extend` priorities.
  override() { return this.setPrio(Priority.Override) }

  /// @internal
  flatten(priority: Priority, target: Extension[] = []) {
    if (this.kind == Kind.Multi) for (let ext of this.value as Extension[])
      ext.flatten(this.priority != Priority.None ? this.priority : priority, target)
    else target.push(this.priority != Priority.None ? this : this.setPrio(priority))
    return target
  }

  /// Insert this extension in an array of extensions so that it
  /// appears after any already-present extensions with the same or
  /// lower priority, but before any extensions with higher priority.
  /// @internal
  collect(array: Extension[]) {
    let i = 0
    while (i < array.length && array[i].priority >= this.priority) i++
    array.splice(i, 0, this)
  }

  /// Combine a group of extensions into a single extension value.
  static all(...extensions: Extension[]) {
    return new Extension(Kind.Multi, null, extensions, dummyType)
  }
}

const dummyType = new ExtensionType

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

  subs(specs: any[], priority: Priority) {
    let subs = this.instantiate(specs).flatten(priority)
    for (let sub of subs)
      if (sub.kind == Kind.Unique && this.knownSubs.indexOf(sub.id) == -1) this.knownSubs.push(sub.id)
    return subs
  }
}

const none: readonly any[] = []

/// A behavior store records the values associated with each behavior
/// in a given configuration. It is created with
/// `ExtensionType.resolve`.
export class BehaviorStore {
  /// @internal
  behaviors: any[] = []
  /// @internal
  values: any[][] = []
  // Any extensions that weren't an instance of the given type when
  // resolving.
  foreign: Extension[] = []

  /// Retrieve the values for a given behavior.
  get<Value>(behavior: Behavior<Value>): readonly Value[] {
    let found = this.behaviors.indexOf(behavior)
    return found < 0 ? none : this.values[found]
  }
}

// Find the extension type that must be resolved next, meaning it is
// not a (transitive) sub-extension of any other extensions that are
// still in extenders.
function findTopUnique(extensions: Extension[], type: ExtensionType): UniqueExtensionType | null {
  let foundUnique = false
  for (let ext of extensions) if (ext.kind == Kind.Unique && ext.type == type) {
    foundUnique = true
    if (!extensions.some(e => e.kind == Kind.Unique && (e.id as UniqueExtensionType).hasSub(ext.id)))
      return ext.id
  }
  if (foundUnique) throw new RangeError("Sub-extension cycle in unique extensions")
  return null
}

type NonUndefined<T> = T extends undefined ? never : T

/// A type function that removes optional modifiers, used to specify
/// the type of `combineConfig`.
export type Full<T> = {[K in keyof T]-?: T[K]}

/// Utility function for combining behaviors to fill in a config
/// object from an array of provided configs. Will, by default, error
/// when a field gets two values that aren't ===-equal, but you can
/// provide combine functions per field to do something else.
export function combineConfig<Config>(
  configs: readonly Config[],
  defaults: Partial<Config>, // Should hold only the optional properties of Config, but I haven't managed to express that
  combine: {[P in keyof Config]?: (first: NonUndefined<Config[P]>, second: NonUndefined<Config[P]>) => NonUndefined<Config[P]>} = {}
): Full<Config> {
  let result: any = {}
  for (let config of configs) for (let key of Object.keys(config) as (keyof Config)[]) {
    let value = config[key], current = result[key]
    if (current === undefined) result[key] = value
    else if (current === value || value === undefined) {} // No conflict
    else if (Object.hasOwnProperty.call(combine, key)) result[key] = combine[key]!(current as any, value as any)
    else throw new Error("Config merge conflict for field " + key)
  }
  for (let key in defaults) if (result[key] === undefined) result[key] = defaults[key]
  return result
}

/// Defaults the fields in a configuration object to values given in
/// `defaults` if they are not already present.
export function fillConfig<Config>(config: Config, defaults: Partial<Config>): Full<Config> {
  let result: any = {}
  for (let key in config) result[key] = config[key]
  for (let key in defaults) if (result[key] === undefined) result[key] = defaults[key]
  return result
}
