declare const extensionBrand: unique symbol

/// Extensions can either be values created by behaviors or unique
/// extensions, or arrays of extension values.
export type Extension = {[extensionBrand]: true} | readonly Extension[]

const enum Prec { None = -2, Fallback = -1, Default = 0, Extend = 1, Override = 2 }

const enum Kind { Behavior, Array }

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

  /// Resolve an array of extensions by expanding all extensions until
  /// only behaviors are left, and then collecting the behaviors into
  /// arrays of values, preserving precedence ordering throughout.
  resolve(extensions: readonly Extension[]) {
    let flat: ExtensionValue[] = []
    flatten(extensions, Prec.Default, new Set<Extension>(), flat)

    // Collect the behavior values.
    let foreign: ExtensionValue[] = []
    let readBehavior: {[id: number]: (context: Context) => any} = Object.create(null)
    for (let ext of flat) {
      if (ext.type != this) {
        // Collect extensions of the wrong type into configuration.foreign
        foreign.push(ext)
        continue
      }
      let behavior = BehaviorData.get(ext.id as Behavior<any, any>)
      if (Object.prototype.hasOwnProperty.call(readBehavior, behavior.id)) continue // Already collected
      let values: ExtensionValue[] = []
      for (let e of flat) if (e.id == ext.id) e.collect(values)
      let dynamic: {read: (values: {[id: number]: any}) => any, index: number}[] = [], parts: any[] = []
      values.forEach(ext => {
        if (ext.value.dynamic) {
          dynamic.push({read: ext.value.dynamic, index: parts.length})
          parts.push(null)
        } else {
          parts.push(ext.value.static)
        }
      })
      if (dynamic.length == 0) {
        let value = behavior.combine(parts)
        readBehavior[behavior.id] = () => value
      } else {
        let cached: any, cachedValue: any
        readBehavior[behavior.id] = (context: Context) => {
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
    }
    return new Configuration(this, extensions, readBehavior, foreign)
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

function flatten(extension: Extension, prec: Prec,
                 seen: Set<Extension>,
                 target: ExtensionValue[] = []): void {
  if (seen.has(extension)) return
  seen.add(extension)

  if (Array.isArray(extension)) {
    for (let ext of extension) flatten(ext, prec, seen, target)
  } else {
    let value = extension as ExtensionValue
    if (value.kind == Kind.Array) {
      for (let ext of value.value as Extension[])
        flatten(ext, value.prec == Prec.None ? prec : value.prec, seen, target)
    } else {
      target.push(value.prec != Prec.None ? value : new ExtensionValue(value.kind, value.id, value.value, value.type, prec))
    }
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
  replaceExtensions(replace: readonly [Extension, Extension][]) {
    let extensions = this.extensions.map(e => {
      for (let [from, to] of replace) if (e == from) return to
      return e
    })
    return this.type.resolve(extensions)
  }
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
