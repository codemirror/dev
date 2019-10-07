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

declare const extensionBrand: unique symbol

/// Extensions can either be values created by behaviors or unique
/// extensions, or arrays of extension values.
export type Extension = {[extensionBrand]: true} | ExtensionArray

const enum Prec { None = -2, Fallback = -1, Default = 0, Extend = 1, Override = 2 }

const enum Kind { Behavior, Array, Unique, Name }

class BehaviorData {
  empty: any
  static: boolean
  
  constructor(readonly combine: (values: readonly any[]) => any,
              isStatic: boolean,
              readonly id: number) {
    this.static = isStatic
    this.empty = combine(none)
  }

  static get(behavior: Behavior<any, any>) {
    let value = (behavior as any)._data
    if (!value) throw new RangeError("Not a behavior")
    return value as BehaviorData
  }
}

/// Behaviors are the way in which CodeMirror is configured. Each
/// behavior, in a state or view, can have zero or more values of the
/// appropriate type associated with it by extensions. A behavior type
/// is a function that can be called to create an extension adding
/// that behavior, but also serves as the key that identifies the
/// behavior.
export type Behavior<Input, Output> = (value: Input) => Extension

/// All extensions are associated with an extension group. This is
/// used to distinguish extensions meant for different types of hosts
/// (such as the editor view and state).
export class ExtensionGroup<Context> {
  private nextStorageID = 0

  /// Create a new group. Client code probably doesn't need to do
  /// this. `getStore` retrieves the id-to-value map from a context
  /// object.
  constructor(readonly getStore: (context: Context) => {[id: number]: any}) {}

  /// Define a type of behavior. All extensions eventually resolve to
  /// behaviors. Each behavior can have an ordered sequence of values
  /// associated with it.
  ///
  /// Behaviors can optionally define a `combine` function, which
  /// precomputes some value from their elements. If no such function
  /// is given, their output type is just that array.
  ///
  /// Behaviors marked as static don't allow
  /// [dynamic](#extension.ExtensionGroup.dynamic) extensions, which
  /// means they can be [read](#extension.Configuration.getBehavior)
  /// without a context (and are cheaper to maintain since they never
  /// change).
  behavior<Input>(options?: {static?: boolean}): Behavior<Input, readonly Input[]>
  behavior<Input, Output>(options: {combine: (values: readonly Input[]) => Output, static?: boolean}): Behavior<Input, Output>
  behavior<Input, Output>(
    options: {combine?: (values: readonly Input[]) => Output, static?: boolean} = {}
  ): Behavior<Input, Output> {
    let behavior = (value: Input) => new ExtensionValue(Kind.Behavior, behavior, {static: value}, this)
    ;(behavior as any)._data = new BehaviorData(options.combine || (array => array as any), !!options.static, this.storageID())
    return behavior
  }

  /// Create an extension that adds a dynamically computed value for a
  /// given behavior. Dynamic behavior should usually just read and
  /// possibly transform a field from the context.
  dynamic<Input>(behavior: Behavior<Input, any>, read: (context: Context) => Input): Extension {
    if (BehaviorData.get(behavior).static) throw new Error("Can't create a dynamic source for a static behavior")
    return new ExtensionValue(Kind.Behavior, behavior, {dynamic: read}, this)
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
      return new ExtensionValue(Kind.Unique, type, spec, this)
    }
  }

  /// Resolve an array of extensions by expanding all extensions until
  /// only behaviors are left, and then collecting the behaviors into
  /// arrays of values, preserving precedence ordering throughout.
  resolve(extensions: readonly Extension[]) {
    return this.resolveInner(extensions)
  }

  /// @internal
  resolveInner(extensions: readonly Extension[], replace: readonly NamedExtensionValue[] = none): Configuration<Context> {
    let pending: ExtensionValue[] = flatten(extensions, Prec.Default, replace)
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
      top.resolve(pending, replace)
      resolved.push(top)
    }

    // Collect the behavior values.
    let foreign: ExtensionValue[] = []
    let readBehavior: {[id: number]: (context: Context) => any} = Object.create(null)
    for (let ext of pending) {
      if (ext.type != this) {
        // Collect extensions of the wrong type into configuration.foreign
        foreign.push(ext)
        continue
      }
      let behavior = BehaviorData.get(ext.id as Behavior<any, any>)
      if (Object.prototype.hasOwnProperty.call(readBehavior, behavior.id)) continue // Already collected
      let values: ExtensionValue[] = []
      for (let e of pending) if (e.id == ext.id) e.collect(values)
      let dynamic: {read: (values: {[id: number]: any}) => any, index: number}[] = [], parts: any[] = []
      values.forEach(ext => {
        if (ext.value.dynamic) {
          dynamic.push({read: ext.value.dynamic, index: parts.length})
          parts.push(null)
        } else {
          parts.push(ext.value.static)
        }
      })
      let cached: any, cachedValue: any
      readBehavior[behavior.id] = dynamic.length == 0 ? () => parts : (context: Context) => {
        let values = this.getStore(context), found = values[behavior.id]
        if (found !== undefined || Object.prototype.hasOwnProperty.call(values, behavior.id)) return found
        let array = parts.slice(), changed = false
        for (let {read, index} of dynamic) {
          let newValue = array[index] = read(context)
          if (!cached || cached[index] != newValue) changed = true
        }
        cached = array
        return values[behavior.id] = changed ? cachedValue = behavior.combine(array) : cachedValue
      }
    }
    return new Configuration(this, extensions, replace, readBehavior, foreign)
  }

  /// Define an extension name. Names can be used to tag extensions.
  /// This method returns a function that can be used to create named
  /// extensions, which can be used in a configuration as normal, but
  /// allow [replacement](#extension.Configuration.replaceExtensions)
  /// with another extension at some point in the future.
  defineName(): (extension: Extension) => Extension {
    let name = (extension: Extension) => new ExtensionValue(Kind.Name, name, extension, this)
    return name
  }

  /// Allocate a unique storage number for use in field storage. Not
  /// something client code is likely to need.
  storageID() { return ++this.nextStorageID }

  /// Mark an extension with a precedence below the default
  /// precedence, which will cause default-precedence extensions to
  /// override it even if they are specified later in the extension
  /// ordering.
  fallback = setPrec(Prec.Fallback)
  /// Mark an extension with normal precedence.
  normal = setPrec(Prec.Default)
  /// Mark an extension with a precedence above the default precedence.
  extend = setPrec(Prec.Extend)
  /// Mark an extension with a precedence above the default and
  /// `extend` precedences.
  override = setPrec(Prec.Override)
}

// FIXME this is a hack to get around TypeScript's lack of recursive
// type aliases, and should be unnnecessary in TS 3.7
interface ExtensionArray extends ReadonlyArray<Extension> {}

function setPrec(prec: Prec): (extension: Extension) => Extension {
  return (extension: Extension) => extension instanceof ExtensionValue
    ? new ExtensionValue(extension.kind, extension.id, extension.value, extension.type, prec)
    : new ExtensionValue(Kind.Array, null, extension, null, prec)
}

/// And extension is a value that describes a way in which something
/// is to be extended. It can be produced by instantiating a behavior,
/// calling unique extension function, or grouping extensions with
/// `Extension.all`.
class ExtensionValue {
  /// @internal
  constructor(
    /// @internal
    readonly kind: Kind,
    /// @internal
    readonly id: any,
    /// Holds the field for behaviors, the spec for unique extensions,
    /// and the array of extensions for multi extensions. @internal
    readonly value: any,
    /// @internal
    readonly type: ExtensionGroup<any> | null,
    /// @internal
    readonly prec: number = Prec.None
  ) {}

  [extensionBrand]!: true

  // Insert this extension in an array of extensions so that it
  // appears after any already-present extensions with the same or
  // lower precedence, but before any extensions with higher
  // precedence.
  collect(array: ExtensionValue[]) {
    let i = 0
    while (i < array.length && array[i].prec >= this.prec) i++
    array.splice(i, 0, this)
  }
}

type NamedExtensionValue = ExtensionValue & {kind: Kind.Name}

function flatten(extension: Extension, prec: Prec,
                 replace: readonly NamedExtensionValue[],
                 target: ExtensionValue[] = []): ExtensionValue[] {
  if (Array.isArray(extension)) {
    for (let ext of extension) flatten(ext, prec, replace, target)
  } else {
    let value = extension as ExtensionValue
    if (value.kind == Kind.Name) {
      let inner = value.value
      for (let r of replace) if (r.id == value.id) inner = r.value
      flatten(inner, value.prec == Prec.None ? prec : value.prec, replace, target)
    } else if (value.kind == Kind.Array) {
      for (let ext of value.value as Extension[])
        flatten(ext, value.prec == Prec.None ? prec : value.prec, replace, target)
    } else {
      target.push(value.prec != Prec.None ? value : new ExtensionValue(value.kind, value.id, value.value, value.type, prec))
    }
  }
  return target
}

class UniqueExtensionType {
  knownSubs: UniqueExtensionType[] = []

  constructor(public instantiate: (...specs: any[]) => Extension) {}

  hasSub(type: UniqueExtensionType): boolean {
    for (let known of this.knownSubs)
      if (known == type || known.hasSub(type)) return true
    return false
  }

  resolve(extensions: ExtensionValue[], replace: readonly NamedExtensionValue[]) {
    // Replace all instances of this type in extneions with the
    // sub-extensions that instantiating produces.
    let ours: ExtensionValue[] = []
    for (let ext of extensions) if (ext.id == this) ext.collect(ours)
    let first = true
    for (let i = 0; i < extensions.length; i++) {
      let ext = extensions[i]
      if (ext.id != this) continue
      let sub = first ? this.subs(ours.map(s => s.value), ext.prec, replace) : none
      extensions.splice(i, 1, ...sub)
      first = false
      i += sub.length - 1
    }
  }

  subs(specs: any[], prec: Prec, replace: readonly NamedExtensionValue[]) {
    let subs = flatten(this.instantiate(specs), prec, replace)
    for (let sub of subs)
      if (sub.kind == Kind.Unique && this.knownSubs.indexOf(sub.id) == -1) this.knownSubs.push(sub.id)
    return subs
  }
}

const none: readonly any[] = []

/// A configuration describes the fields and behaviors that exist in a
/// given set of extensions. It is created with
/// [`ExtensionGroup.resolve`](#extension.ExtensionGroup.resolve).
export class Configuration<Context> {
  /// @internal
  constructor(
    private type: ExtensionGroup<Context>,
    private extensions: readonly Extension[],
    private replaced: readonly NamedExtensionValue[],
    private readBehavior: {[id: number]: (context: Context) => any},
    /// Any extensions that weren't an instance of the target
    /// extension group when resolving.
    readonly foreign: readonly Extension[] = []
  ) {}

  /// Retrieve the value of a given behavior. When the behavior is
  /// [static](#extension.ExtensionGroup.behavior), the `context`
  /// argument can be omitted.
  getBehavior<Output>(behavior: Behavior<any, Output>, context?: Context): Output {
    let data = BehaviorData.get(behavior)
    if (!context && !data.static) throw new RangeError("Need a context to retrieve non-static behavior")
    let f = this.readBehavior[data.id]
    return f ? f(context!) : data.empty
  }

  /// Replace one or more extensions with new ones, producing a new
  /// configuration.
  replaceExtensions(replace: readonly Extension[]) {
    let repl = replace as readonly NamedExtensionValue[]
    for (let r of repl) if (r.kind != Kind.Name)
      throw new RangeError("Extension replacements must be named extension values")
    return this.type.resolveInner(this.extensions, this.replaced.filter(p => !repl.some(r => r.id == p.id)).concat(repl))
  }
}

// Find the extension type that must be resolved next, meaning it is
// not a (transitive) sub-extension of any other extensions that are
// still in extenders.
function findTopUnique(extensions: ExtensionValue[], type: ExtensionGroup<any>): UniqueExtensionType | null {
  let foundUnique = false
  for (let ext of extensions) if (ext.kind == Kind.Unique && ext.type == type) {
    foundUnique = true
    if (!extensions.some(e => e.kind == Kind.Unique && (e.id as UniqueExtensionType).hasSub(ext.id)))
      return ext.id
  }
  if (foundUnique) throw new RangeError("Sub-extension cycle in unique extensions")
  return null
}

/// Utility function for combining behaviors to fill in a config
/// object from an array of provided configs. Will, by default, error
/// when a field gets two values that aren't ===-equal, but you can
/// provide combine functions per field to do something else.
export function combineConfig<Config>(
  configs: readonly Partial<Config>[],
  defaults: Partial<Config>, // Should hold only the optional properties of Config, but I haven't managed to express that
  combine: {[P in keyof Config]?: (first: Config[P], second: Config[P]) => Config[P]} = {}
): Config {
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
export function fillConfig<Config>(config: Config, defaults: Partial<Config>): Required<Config> {
  let result: any = {}
  for (let key in config) result[key] = config[key]
  for (let key in defaults) if (result[key] === undefined) result[key] = defaults[key]
  return result
}
