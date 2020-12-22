import {Transaction} from "./transaction"
import {EditorState} from "./state"

let nextID = 0

type FacetConfig<Input, Output> = {
  /// How to combine the input values into a single output value. When
  /// not given, the array of input values becomes the output. This
  /// will immediately be called on creating the facet, with an empty
  /// array, to compute the facet's default value when no inputs are
  /// present.
  combine?: (value: readonly Input[]) => Output,
  /// How to compare output values to determine whether the value of
  /// the facet changed. Defaults to comparing by `===` or, if no
  /// `combine` function was given, comparing each element of the
  /// array with `===`.
  compare?: (a: Output, b: Output) => boolean,
  /// How to compare input values to avoid recomputing the output
  /// value when no inputs changed. Defaults to comparing with `===`.
  compareInput?: (a: Input, b: Input) => boolean,
  /// Static facets can not contain dynamic inputs.
  static?: boolean,
  /// If given, these extension(s) will be added to any state where
  /// this facet is provided. (Note that, while a facet's default
  /// value can be read from a state even if the facet wasn't present
  /// in the state at all, these extensions won't be added in that
  /// situation.)
  enables?: Extension
}

/// A facet is a labeled value that is associated with an editor
/// state. It takes inputs from any number of extensions, and combines
/// those into a single output value.
///
/// Examples of facets are the [theme](#view.EditorView^theme) styles
/// associated with an editor or the [tab
/// size](#state.EditorState^tabSize) (which is reduced to a single
/// value, using the input with the hightest precedence).
export class Facet<Input, Output = readonly Input[]> {
  /// @internal
  readonly id = nextID++
  /// @internal
  readonly default: Output

  private constructor(
    /// @internal
    readonly combine: (values: readonly Input[]) => Output,
    /// @internal
    readonly compareInput: (a: Input, b: Input) => boolean,
    /// @internal
    readonly compare: (a: Output, b: Output) => boolean,
    private isStatic: boolean,
    /// @internal
    readonly extensions: Extension | undefined
  ) {
    this.default = combine([])
  }

  /// Define a new facet.
  static define<Input, Output = readonly Input[]>(config: FacetConfig<Input, Output> = {}) {
    return new Facet<Input, Output>(config.combine || ((a: any) => a) as any,
                                    config.compareInput || ((a, b) => a === b),
                                    config.compare || (!config.combine ? sameArray as any : (a, b) => a === b),
                                    !!config.static,
                                    config.enables)
  }

  /// Returns an extension that adds the given value for this facet.
  of(value: Input): Extension {
    return new FacetProvider<Input>([], this, Provider.Static, value)
  }

  /// Create an extension that computes a value for the facet from a
  /// state. You must take care to declare the parts of the state that
  /// this value depends on, since your function is only called again
  /// for a new state when one of those parts changed.
  ///
  /// In most cases, you'll want to use the
  /// [`provide`](#state.StateField^define^config.provide) option when
  /// defining a field instead.
  compute(deps: readonly Slot<any>[], get: (state: EditorState) => Input): Extension {
    if (this.isStatic) throw new Error("Can't compute a static facet")
    return new FacetProvider<Input>(deps, this, Provider.Single, get)
  }

  /// Create an extension that computes zero or more values for this
  /// facet from a state.
  computeN(deps: readonly Slot<any>[], get: (state: EditorState) => readonly Input[]): Extension {
    if (this.isStatic) throw new Error("Can't compute a static facet")
    return new FacetProvider<Input>(deps, this, Provider.Multi, get)
  }

  /// Shorthand method for registering a facet source with a state
  /// field as input. If the field's type corresponds to this facet's
  /// input type, the getter function can be omitted. If given, it
  /// will be used to retrieve the input from the field value.
  from(field: StateField<Input>): Extension
  from<T>(field: StateField<T>, get: (value: T) => Input): Extension
  from<T>(field: StateField<T>, get?: (value: T) => Input): Extension {
    if (!get) get = x => x as any
    return this.compute([field], state => get!(state.field(field)))
  }
}

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a == b || a.length == b.length && a.every((e, i) => e === b[i])
}

type Slot<T> = Facet<any, T> | StateField<T> | "doc" | "selection"

const enum Provider { Static, Single, Multi }

class FacetProvider<Input> {
  readonly id = nextID++
  extension!: Extension // Kludge to convince the type system these count as extensions

  constructor(readonly dependencies: readonly Slot<any>[],
              readonly facet: Facet<Input, any>,
              readonly type: Provider,
              readonly value: ((state: EditorState) => Input) | ((state: EditorState) => readonly Input[]) | Input) {}

  dynamicSlot(addresses: {[id: number]: number}) {
    let getter: (state: EditorState) => any = this.value as any
    let compare = this.facet.compareInput
    let idx = addresses[this.id] >> 1, multi = this.type == Provider.Multi
    let depDoc = false, depSel = false, depAddrs: number[] = []
    for (let dep of this.dependencies) {
      if (dep == "doc") depDoc = true
      else if (dep == "selection") depSel = true
      else if (((addresses[dep.id] ?? 1) & 1) == 0) depAddrs.push(addresses[dep.id])
    }

    return (state: EditorState, tr: Transaction | null) => {
      if (!tr || tr.reconfigure) {
        state.values[idx] = getter(state)
        return SlotStatus.Changed
      } else {
        let depChanged = (depDoc && tr.docChanged) || (depSel && (tr.docChanged || tr.selection)) || 
          depAddrs.some(addr => (ensureAddr(state, addr) & SlotStatus.Changed) > 0)
        if (!depChanged) return 0
        let newVal = getter(state), oldVal = tr.startState.values[idx]
        if (multi ? compareArray(newVal, oldVal, compare) : compare(newVal, oldVal)) return 0
        state.values[idx] = newVal
        return SlotStatus.Changed
      }
    }
  }
}

function compareArray<T>(a: readonly T[], b: readonly T[], compare: (a: T, b: T) => boolean) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!compare(a[i], b[i])) return false
  return true
}

function dynamicFacetSlot<Input, Output>(
  addresses: {[id: number]: number},
  facet: Facet<Input, Output>,
  providers: readonly FacetProvider<Input>[]
) {
  let providerAddrs = providers.map(p => addresses[p.id])
  let providerTypes = providers.map(p => p.type)
  let dynamic = providerAddrs.filter(p => !(p & 1))
  let idx = addresses[facet.id] >> 1

  return (state: EditorState, tr: Transaction | null) => {
    let oldAddr = !tr ? null : tr.reconfigure ? tr.startState.config.address[facet.id] : idx << 1
    let changed = oldAddr == null
    for (let dynAddr of dynamic) {
      if (ensureAddr(state, dynAddr) & SlotStatus.Changed) changed = true
    }
    if (!changed) return 0
    let values: Input[] = []
    for (let i = 0; i < providerAddrs.length; i++) {
      let value = getAddr(state, providerAddrs[i])
      if (providerTypes[i] == Provider.Multi) for (let val of value) values.push(val)
      else values.push(value)
    }
    let newVal = facet.combine(values)
    if (oldAddr != null && facet.compare(newVal, getAddr(tr!.startState, oldAddr))) return 0
    state.values[idx] = newVal
    return SlotStatus.Changed
  }
}

type StateFieldSpec<Value> = {
  /// Creates the initial value for the field when a state is created.
  create: (state: EditorState) => Value,

  /// Compute a new value from the field's previous value and a
  /// [transaction](#state.Transaction).
  update: (value: Value, transaction: Transaction) => Value,

  /// Compare two values of the field, returning `true` when they are
  /// the same. This is used to avoid recomputing facets that depend
  /// on the field when its value did not change. Defaults to using
  /// `===`.
  compare?: (a: Value, b: Value) => boolean,

  /// Provide values for facets based on the value of this field. The
  /// given function will be called once with the initializedfield. It
  /// will usually want to call some facet's
  /// [`from`](#state.Facet.from) method to create facet inputs from
  /// this field, but can also return other extensions that should be
  /// enabled by this field.
  provide?: (field: StateField<Value>) => Extension

  /// A function used to serialize this field's content to JSON. Only
  /// necessary when this field is included in the argument to
  /// [`EditorState.toJSON`](#state.EditorState.toJSON).
  toJSON?: (value: Value, state: EditorState) => any

  /// A function that deserializes the JSON representation of this
  /// field's content.
  fromJSON?: (json: any, state: EditorState) => Value
}

function maybeIndex(state: EditorState, id: number) {
  let found = state.config.address[id]
  return found == null ? null : found >> 1
}

const initField = Facet.define<{field: StateField<unknown>, create: (state: EditorState) => unknown}>({static: true})

/// Fields can store additional information in an editor state, and
/// keep it in sync with the rest of the state.
export class StateField<Value> {
  /// @internal
  public provides: Extension | undefined = undefined

  private constructor(
    /// @internal
    readonly id: number,
    private createF: (state: EditorState) => Value,
    private updateF: (value: Value, tr: Transaction) => Value,
    private compareF: (a: Value, b: Value) => boolean,
    /// @internal
    readonly spec: StateFieldSpec<Value>
  ) {}

  /// Define a state field.
  static define<Value>(config: StateFieldSpec<Value>): StateField<Value> {
    let field = new StateField<Value>(nextID++, config.create, config.update, config.compare || ((a, b) => a === b), config)
    if (config.provide) field.provides = config.provide(field)
    return field
  }

  private create(state: EditorState) {
    let init = state.facet(initField).find(i => i.field == this)
    return (init?.create || this.createF)(state)
  }

  /// @internal
  slot(addresses: {[id: number]: number}) {
    let idx = addresses[this.id] >> 1
    return (state: EditorState, tr: Transaction | null) => {
      if (!tr) {
        state.values[idx] = this.create(state)
        return SlotStatus.Changed
      }
      let oldVal, changed = 0
      if (tr.reconfigure) {
        let oldIdx = maybeIndex(tr.startState, this.id)
        oldVal = oldIdx == null ? this.create(tr.startState) : tr.startState.values[oldIdx]
        changed = SlotStatus.Changed
      } else {
        oldVal = tr.startState.values[idx]
      }
      let value = this.updateF(oldVal, tr!)
      if (!changed && !this.compareF(oldVal, value)) changed = SlotStatus.Changed
      if (changed) state.values[idx] = value
      return changed
    }
  }

  /// Returns an extension that enables this field and overrides the
  /// way it is initialized. Can be useful when you need to provide a
  /// non-default starting value for the field.
  init(create: (state: EditorState) => Value): Extension {
    return [this, initField.of({field: this as any, create})]
  }

  /// State field instances can be used as
  /// [`Extension`](#state.Extension) values to enable the field in a
  /// given state.
  extension!: Extension
}

/// Extension values can be
/// [provided](#state.EditorStateConfig.extensions) when creating a
/// state to attach various kinds of configuration and behavior
/// information. They can either be built-in extension-providing
/// objects, such as [state fields](#state.StateField) or [facet
/// providers](#state.Facet.of), or objects with an extension in its
/// `extension` property. Extensions can be nested in arrays
/// arbitrarily deep—they will be flattened when processed.
export type Extension = {extension: Extension} | readonly Extension[]

const Prec_ = {fallback: 3, default: 2, extend: 1, override: 0}

function prec(value: number) {
  return (ext: Extension) => new PrecExtension(ext, value) as Extension
}

/// By default extensions are registered in the order they are found
/// in the flattened form of nested array that was provided.
/// Individual extension values can be assigned a precedence to
/// override this. Extensions that do not have a precedence set get
/// the precedence of the nearest parent with a precedence, or
/// [`default`](#state.Prec.default) if there is no such parent. The
/// final ordering of extensions is determined by first sorting by
/// precedence and then by order within each precedence.
export const Prec = {
  /// A precedence below the default precedence, which will cause
  /// default-precedence extensions to override it even if they are
  /// specified later in the extension ordering.
  fallback: prec(Prec_.fallback),
  /// The regular default precedence.
  default: prec(Prec_.default),
  /// A higher-than-default precedence.
  extend: prec(Prec_.extend),
  /// Precedence above the `default` and `extend` precedences.
  override: prec(Prec_.override)
}

class PrecExtension {
  constructor(readonly inner: Extension, readonly prec: number) {}
  extension!: Extension
}

class TaggedExtension {
  constructor(readonly tag: string | symbol, readonly inner: Extension) {}
  extension!: Extension
}

/// Tagged extensions can be used to make a configuration dynamic.
/// Tagging an extension allows you to later
/// [replace](#state.TransactionSpec.reconfigure) it with
/// another extension. A given tag may only occur once within a given
/// configuration.
export function tagExtension(tag: string | symbol, extension: Extension): Extension {
  return new TaggedExtension(tag, extension)
}

export type ExtensionMap = {[tag: string]: Extension | undefined}

type DynamicSlot = (state: EditorState, tr: Transaction | null) => number

export class Configuration {
  readonly statusTemplate: SlotStatus[] = []

  constructor(readonly source: Extension,
              readonly replacements: ExtensionMap,
              readonly dynamicSlots: DynamicSlot[],
              readonly address: {[id: number]: number},
              readonly staticValues: readonly any[]) {
    while (this.statusTemplate.length < dynamicSlots.length)
      this.statusTemplate.push(SlotStatus.Uninitialized)
  }

  staticFacet<Output>(facet: Facet<any, Output>) {
    let addr = this.address[facet.id]
    return addr == null ? facet.default : this.staticValues[addr >> 1]
  }

  static resolve(extension: Extension, replacements: ExtensionMap = Object.create(null), oldState?: EditorState) {
    let fields: StateField<any>[] = []
    let facets: {[id: number]: FacetProvider<any>[]} = Object.create(null)
    for (let ext of flatten(extension, replacements)) {
      if (ext instanceof StateField) fields.push(ext)
      else (facets[ext.facet.id] || (facets[ext.facet.id] = [])).push(ext)
    }

    let address: {[id: number]: number} = Object.create(null)
    let staticValues: any[] = []
    let dynamicSlots: ((address: {[id: number]: number}) => DynamicSlot)[] = []
    for (let field of fields) {
      address[field.id] = dynamicSlots.length << 1
      dynamicSlots.push(a => field.slot(a))
    }
    for (let id in facets) {
      let providers = facets[id], facet = providers[0].facet
      if (providers.every(p => p.type == Provider.Static)) {
        address[facet.id] = (staticValues.length << 1) | 1
        let value = facet.combine(providers.map(p => p.value))
        let oldAddr = oldState ? oldState.config.address[facet.id] : null
        if (oldAddr != null) {
          let oldVal = getAddr(oldState!, oldAddr)
          if (facet.compare(value, oldVal)) value = oldVal
        }
        staticValues.push(value)
      } else {
        for (let p of providers) {
          if (p.type == Provider.Static) {
            address[p.id] = (staticValues.length << 1) | 1
            staticValues.push(p.value)
          } else {
            address[p.id] = dynamicSlots.length << 1
            dynamicSlots.push(a => p.dynamicSlot(a))
          }
        }
        address[facet.id] = dynamicSlots.length << 1
        dynamicSlots.push(a => dynamicFacetSlot(a, facet, providers))
      }
    }

    return new Configuration(extension, replacements, dynamicSlots.map(f => f(address)), address, staticValues)
  }
}

function allKeys(obj: ExtensionMap) {
  return ((Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(obj) : []) as (string | symbol)[]).concat(Object.keys(obj))
}

function flatten(extension: Extension, replacements: ExtensionMap) {
  let result: (FacetProvider<any> | StateField<any>)[][] = [[], [], [], []]
  let seen = new Map<Extension, number>()
  let tagsSeen = Object.create(null)
  function inner(ext: Extension, prec: number) {
    let known = seen.get(ext)
    if (known != null) {
      if (known >= prec) return
      let found = result[known].indexOf(ext as any)
      if (found > -1) result[known].splice(found, 1)
    }
    seen.set(ext, prec)
    if (Array.isArray(ext)) {
      for (let e of ext) inner(e, prec)
    } else if (ext instanceof TaggedExtension) {
      if (ext.tag in tagsSeen)
        throw new RangeError(`Duplicate use of tag '${String(ext.tag)}' in extensions`)
      tagsSeen[ext.tag] = true
      inner(replacements[ext.tag as any] || ext.inner, prec)
    } else if (ext instanceof PrecExtension) {
      inner(ext.inner, ext.prec)
    } else if (ext instanceof StateField) {
      result[prec].push(ext)
      if (ext.provides) inner(ext.provides, prec)
    } else if (ext instanceof FacetProvider) {
      result[prec].push(ext)
      if (ext.facet.extensions) inner(ext.facet.extensions, prec)
    } else {
      inner((ext as any).extension, prec)
    }
  }
  inner(extension, Prec_.default)
  for (let key of allKeys(replacements)) if (!(key in tagsSeen) && key != "full" && replacements[key as any]) {
    tagsSeen[key] = true
    inner(replacements[key as any]!, Prec_.default)
  }
  return result.reduce((a, b) => a.concat(b))
}

export const enum SlotStatus {
  Uninitialized = 0,
  Changed = 1,
  Computed = 2,
  Computing = 4
}

export function ensureAddr(state: EditorState, addr: number) {
  if (addr & 1) return SlotStatus.Computed
  let idx = addr >> 1
  let status = state.status[idx]
  if (status == SlotStatus.Computing) throw new Error("Cyclic dependency between fields and/or facets")
  if (status & SlotStatus.Computed) return status
  state.status[idx] = SlotStatus.Computing
  let changed = state.config.dynamicSlots[idx](state, state.applying)
  return state.status[idx] = SlotStatus.Computed | changed
}

export function getAddr(state: EditorState, addr: number) {
  return addr & 1 ? state.config.staticValues[addr >> 1] : state.values[addr >> 1]
}
