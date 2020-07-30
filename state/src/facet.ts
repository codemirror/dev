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
  static?: boolean
}

/// A facet is a value that is assicated with a state and can be
/// influenced by any number of extensions. Extensions can provide
/// input values for the facet, and the facet combines those into an
/// output value.
///
/// Examples of facets are the theme styles associated with an editor
/// (which are all stored) or the tab size (which is reduced to a
/// single value, using the input with the hightest precedence).
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
    private isStatic: boolean
  ) {
    this.default = combine([])
  }

  /// Define a new facet.
  static define<Input, Output = readonly Input[]>(config: FacetConfig<Input, Output> = {}) {
    return new Facet<Input, Output>(config.combine || ((a: any) => a) as any,
                                    config.compareInput || ((a, b) => a === b),
                                    config.compare || (!config.combine ? sameArray as any : (a, b) => a === b),
                                    !!config.static)
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

  /// Helper method for registering a facet source with a state field
  /// via its [`provide`](#state.StateField^define^config.provide) option.
  /// Returns a value that can be passed to that option to make the
  /// field automatically provide a value for this facet.
  from<T>(get: (value: T) => Input, prec?: Precedence): (field: StateField<T>) => Extension {
    return field => maybePrec(prec, this.compute([field], state => get(state.field(field))))
  }

  /// Helper for [providing](#state.StateField^define^config.provide)
  /// a dynamic number of values for this facet from a state field.
  nFrom<T>(get: (value: T) => readonly Input[], prec?: Precedence): (field: StateField<T>) => Extension {
    return field => maybePrec(prec, this.computeN([field], state => get(state.field(field))))
  }
}

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a == b || a.length == b.length && a.every((e, i) => e === b[i])
}

type Slot<T> = Facet<any, T> | StateField<T> | "doc" | "selection"

// Marks a value as an [`Extension`](#state.Extension).
declare const isExtension: unique symbol

const enum Provider { Static, Single, Multi }

class FacetProvider<Input> {
  readonly id = nextID++

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
      else if ((addresses[dep.id] & 1) == 0) depAddrs.push(addresses[dep.id])
    }

    return (state: EditorState, tr: Transaction | null) => {
      if (!tr || tr.reconfigured) {
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

  [isExtension]!: true
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
    let oldAddr = !tr ? null : tr.reconfigured ? tr.startState.config.address[facet.id] : idx << 1
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
  /// `==`.
  compare?: (a: Value, b: Value) => boolean,

  /// Provide values for facets based on the value of this field. You
  /// can pass facets that directly take the field value as input, or
  /// use facet's [`from`](#state.Facet.from) and
  /// [`nFrom`](#state.Facet.nFrom) methods to provide a getter
  /// function.
  provide?: readonly (Facet<Value, any> | ((field: StateField<Value>) => Extension))[]
}

function maybeIndex(state: EditorState, id: number) {
  let found = state.config.address[id]
  return found == null ? null : found >> 1
}

/// Fields can store additional information in an editor state, and
/// keep it in sync with the rest of the state.
export class StateField<Value> {
  private constructor(
    /// @internal
    readonly id: number,
    private createF: (state: EditorState) => Value,
    private updateF: (value: Value, tr: Transaction) => Value,
    private compareF: (a: Value, b: Value) => boolean,
    /// @internal
    readonly facets: readonly Extension[]
  ) {}

  /// Define a state field.
  static define<Value>(config: StateFieldSpec<Value>): StateField<Value> {
    let facets: Extension[] = []
    let field = new StateField<Value>(nextID++, config.create, config.update, config.compare || ((a, b) => a === b), facets)
    if (config.provide) for (let p of config.provide) {
      if (p instanceof Facet) facets.push(p.compute([field], state => state.field(field)))
      else facets.push(p(field))
    }
    return field
  }

  /// @internal
  slot(addresses: {[id: number]: number}) {
    let idx = addresses[this.id] >> 1
    return (state: EditorState, tr: Transaction | null) => {
      if (!tr) {
        state.values[idx] = this.createF(state)
        return SlotStatus.Changed
      }
      let oldVal, changed = 0
      if (tr.reconfigured) {
        let oldIdx = maybeIndex(tr.startState, this.id)
        oldVal = oldIdx == null ? this.createF(tr.startState) : tr.startState.values[oldIdx]
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

  /// State field instances can be used as
  /// [`Extension`](#state.Extension) values to enable the field in a
  /// given state. (This symbol is a TypeScript-related trick to mark
  /// it as an extension value.)
  [isExtension]!: true
}

/// Extension values can be
/// [provided](#state.EditorStateConfig.extensions) when creating a
/// state to attach various kinds of configuration and behavior
/// information. It may an extension object, such as a [state
/// field](#state.StateField) or facet provider, any object with an
/// extension in its `extension` property, or an array of extension
/// values.
export type Extension = {[isExtension]: true} | {extension: Extension} | readonly Extension[]

/// Valid values of the second argument to
/// [`precedence`](#state.precedence).
///
/// - `"fallback"`: A precedence below the default precedence, which
///   will cause default-precedence extensions to override it even if
///   they are specified later in the extension ordering.
/// - `"default"`: The regular default precedence.
/// - `"extend"`: A higher-than-default precedence.
/// - `"override"`: Precedence above the `"default"` and `"extend"`
///   precedences.
export type Precedence = "fallback" | "default" | "extend" | "override"

const Prec = {fallback: 3, default: 2, extend: 1, override: 0}

/// By default extensions are registered in the order they are found
/// the flattened form of nested array that was provided. Individual
/// extension values can be assigned a precedence to override this.
/// Extensions that do not have a precedence set get the precedence of
/// the nearest parent with a precedence, or
/// [`"default"`](#state.Precedence) if there is no such parent. The
/// final ordering of extensions is determined by first sorting by
/// precedence and then by order within each precedence.
export function precedence(extension: Extension, value: Precedence) {
  if (!Prec.hasOwnProperty(value as string)) throw new RangeError(`Invalid precedence: ${value}`)
  return new PrecExtension(extension, Prec[value])
}

function maybePrec(prec: Precedence | undefined, ext: Extension) {
  return prec ? precedence(ext, prec) : ext
}

class PrecExtension {
  constructor(readonly e: Extension, readonly prec: number) {}
  [isExtension]!: true
}

class TaggedExtension {
  constructor(readonly tag: string | symbol, readonly extension: Extension) {}
  [isExtension]!: true
}

/// Tagged extensions can be used to make a configuration dynamic.
/// Tagging an extension allows you to later
/// [replace](#state.TransactionSpec.replaceExtensions) it with
/// another extension. A given tag may only occur once within a given
/// configuration.
export function tagExtension(tag: string | symbol, extension: Extension) {
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
    while (this.statusTemplate.length < staticValues.length)
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
      inner(replacements[ext.tag as any] || ext.extension, prec)
    } else if ((ext as any).extension) {
      inner((ext as any).extension, prec)
    } else if (ext instanceof PrecExtension) {
      inner(ext.e, ext.prec)
    } else {
      result[prec].push(ext as any)
      if (ext instanceof StateField) inner(ext.facets, prec)
    }
  }
  inner(extension, Prec.default)
  for (let key of allKeys(replacements)) if (!(key in tagsSeen) && key != "full" && replacements[key as any]) {
    tagsSeen[key] = true
    inner(replacements[key as any]!, Prec.default)
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
