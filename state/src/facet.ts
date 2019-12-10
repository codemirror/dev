import {Transaction} from "./transaction"
import {EditorState} from "./state"

let nextID = 0

export class Facet<Input, Output> {
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

  static define<Input, Output = readonly Input[]>(config: {
    combine?: (value: readonly Input[]) => Output,
    compare?: (a: Output, b: Output) => boolean,
    compareInput?: (a: Input, b: Input) => boolean,
    static?: boolean
  } = {}) {
    return new Facet<Input, Output>(config.combine || ((a: any) => a) as any,
                                    config.compareInput || ((a, b) => a === b),
                                    config.compare || (!config.combine ? sameArray as any : (a, b) => a === b),
                                    !!config.static)
  }

  of(value: Input): Extension {
    return new FacetProvider<Input>([], this, Provider.Static, value)
  }

  derive(deps: readonly Slot<any>[], get: (state: EditorState) => Input): Extension {
    if (this.isStatic) throw new Error("Can't derive a static facet")
    return new FacetProvider<Input>(deps, this, Provider.Single, get)
  }

  deriveN(deps: readonly Slot<any>[], get: (state: EditorState) => readonly Input[]): Extension {
    if (this.isStatic) throw new Error("Can't derive a static facet")
    return new FacetProvider<Input>(deps, this, Provider.Multi, get)
  }

  static fallback(e: Extension): Extension { return new PrecExtension(e, P.Fallback) }
  static default(e: Extension): Extension { return new PrecExtension(e, P.Default) }
  static extend(e: Extension): Extension { return new PrecExtension(e, P.Extend) }
  static override(e: Extension): Extension { return new PrecExtension(e, P.Override) }
}

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a == b || a.length == b.length && a.every((e, i) => e === b[i])
}

type Slot<T> = Facet<any, T> | StateField<T> | "doc" | "selection"

/// Marks a value as an [`Extension`](#state.Extension).
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
    let idx = addresses[this.id] >> 1
    let depDoc = false, depSel = false, depAddrs: number[] = []
    for (let dep of this.dependencies) {
      if (dep == "doc") depDoc = true
      else if (dep == "selection") depSel = true
      else if (addresses[dep.id] & 1) depAddrs.push(addresses[dep.id])
    }

    return (state: EditorState, tr: Transaction | null) => {
      if (!tr || (depDoc && tr.docChanged) || (depSel && (tr.docChanged || tr.selectionSet)) || 
          depAddrs.some(addr => { ensureAddr(state, addr); return (state.status[addr >> 1] & SlotStatus.Changed) > 0 })) {
        let newVal = getter(state)
        if (!tr || !compare(newVal, tr.startState.values[idx])) {
          state.values[idx] = newVal
          state.status[idx] = SlotStatus.Computed | SlotStatus.Changed
          return
        }
      }
      state.status[idx] = SlotStatus.Computed
    }
  }

  [isExtension]!: true
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
    let changed = !tr
    for (let dynAddr of dynamic) {
      ensureAddr(state, dynAddr)
      if (!changed && (state.status[dynAddr >> 1] & SlotStatus.Changed)) changed = true
    }
    if (changed) {
      let values: Input[] = []
      for (let i = 0; i < providerAddrs.length; i++) {
        let value = getAddr(state, providerAddrs[i])
        if (providerTypes[i] == Provider.Multi) for (let val of value) values.push(val)
        else values.push(value)
      }
      let newVal = facet.combine(values)
      if (!tr || !facet.compare(newVal, tr.startState.values[idx])) {
        state.values[idx] = newVal
        state.status[idx] = SlotStatus.Computed | SlotStatus.Changed
        return
      }
    }
    state.status[idx] = SlotStatus.Computed
  }
}

/// Parameters passed when creating a
/// [`StateField`](#state.StateField^define). The `Value` type
/// parameter refers to the content of the field. Since it will be
/// stored in (immutable) state objects, it should be an immutable
/// value itself. The `Deps` type parameter is used only for fields
/// with [dependencies](#state.StateField^defineDeps).
export type StateFieldSpec<Value> = {
  /// Creates the initial value for the field when a state is created.
  create: (state: EditorState) => Value,

  /// Compute a new value from the field's previous value and a
  /// [transaction](#state.Transaction).
  update: (value: Value, transaction: Transaction, newState: EditorState) => Value,

  /// Compare two values of the field, returning `true` when they are
  /// the same. This is used to avoid recomputing facets that depend
  /// on the field when its value did not change.
  compare?: (a: Value, b: Value) => boolean,
}

/// Fields can store additional information in an editor state, and
/// keep it in sync with the rest of the state.
export class StateField<Value> {
  /// @internal
  readonly id = nextID++

  private constructor(
    private createF: (state: EditorState) => Value,
    private updateF: (value: Value, tr: Transaction, state: EditorState) => Value,
    private compareF: (a: Value, b: Value) => boolean
  ) {}

  /// Define a state field.
  static define<Value>(config: StateFieldSpec<Value>): StateField<Value> {
    return new StateField<Value>(config.create, config.update,
                                 config.compare || ((a, b) => a === b))
  }

  slot(addresses: {[id: number]: number}) {
    let idx = addresses[this.id] >> 1
    return (state: EditorState, tr: Transaction | null) => {
      if (!tr) {
        state.values[idx] = this.createF(state)
        state.status[idx] = SlotStatus.Computed | SlotStatus.Changed
      } else {
        let value = this.updateF(tr.startState.values[idx], tr, state), status = SlotStatus.Computed
        if (!this.compareF(tr.startState.values[idx], value)) {
          state.values[idx] = value
          status |= SlotStatus.Changed
        }
        state.status[idx] = status
      }
    }
  }

  [isExtension]!: true
}

export type Extension = {[isExtension]: true} | readonly Extension[]

type DynamicSlot = (state: EditorState, tr: Transaction | null) => void

const enum P { Override, Extend, Default, Fallback }

class PrecExtension {
  constructor(readonly e: Extension, readonly prec: P) {}
  [isExtension]!: true
}

export class Configuration {
  constructor(readonly dynamicSlots: DynamicSlot[],
              readonly address: {[id: number]: number},
              readonly staticValues: readonly any[]) {}

  staticFacet<Output>(facet: Facet<any, Output>) {
    let addr = this.address[facet.id]
    return addr == null ? facet.default : this.staticValues[addr >> 1]
  }

  // Passing EditorState as argument to avoid cyclic dependency
  static resolve(extension: Extension) {
    let fields: StateField<any>[] = []
    let facets: {[id: number]: FacetProvider<any>[]} = Object.create(null)
    for (let ext of flatten(extension)) {
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
        staticValues.push(facet.combine(providers.map(p => p.value)))
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

    return new Configuration(dynamicSlots.map(f => f(address)), address, staticValues)
  }
}

function flatten(extension: Extension) {
  let result: (FacetProvider<any> | StateField<any>)[][] = [[], [], [], []]
  let seen = new Set<Extension>()
  ;(function inner(ext, prec: P) {
    if (seen.has(ext)) return
    seen.add(ext)
    if (Array.isArray(ext)) for (let e of ext) inner(e, prec)
    else if (ext instanceof PrecExtension) inner(ext.e, ext.prec)
    else result[prec].push(ext as any)
  })(extension, P.Default)
  return result.reduce((a, b) => a.concat(b))
}

export const enum SlotStatus {
  Uninitialized = 0,
  Changed = 1,
  Computed = 2,
  Computing = 4
}

export function ensureAddr(state: EditorState, addr: number) {
  if (addr & 1) return
  let idx = addr >> 1
  let status = state.status[idx]
  if (status == SlotStatus.Computing) throw new Error("Cyclic dependency between fields and/or facets")
  if ((status & SlotStatus.Computed) == 0) {
    state.status[idx] = SlotStatus.Computing
    state.config.dynamicSlots[idx](state, state.applying)
  }
}

export function getAddr(state: EditorState, addr: number) {
  return addr & 1 ? state.config.staticValues[addr >> 1] : state.values[addr >> 1]
}

export function initState(state: EditorState, tr: Transaction | null) {
  state.applying = tr
  for (let i = 0; i < state.config.dynamicSlots.length; i++) ensureAddr(state, i << 1)
  state.applying = null
  return state
}
