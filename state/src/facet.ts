import {Transaction} from "./transaction"
import {EditorSelection} from "./selection"
import {EditorState} from "./state"
import {Text} from "../../text"

let nextID = 0

const none: readonly any[] = []

export class Facet<Input, Output> {
  /// @internal
  readonly id = nextID++
  /// @internal
  readonly default: Output

  private constructor(
    /// @internal
    readonly combine: (values: readonly Input[]) => Output,
    /// @internal
    readonly compare: (a: Output, b: Output) => boolean,
    private isStatic: boolean
  ) {
    this.default = combine([])
  }

  static define<Input, Output = readonly Input[]>(config: {
    combine?: (value: readonly Input[]) => Output,
    compare?: (a: Output, b: Output) => boolean,
    static?: boolean
  } = {}) {
    return new Facet<Input, Output>(config.combine || ((a: any) => a) as any,
                                    config.compare || (!config.combine ? sameArray as any : (a, b) => a === b),
                                    !!config.static)
  }

  of(value: Input): Extension {
    return new FacetProvider<Input>(none, this, (_, output) => output.push(value))
  }

  derive(deps: readonly Slot<any>[], get: (state: EditorState) => Input): Extension {
    if (this.isStatic) throw new Error("Can't derive a static facet")
    return new FacetProvider<Input>(deps, this, (state, output) => output.push(get(state)))
  }

  deriveN(deps: readonly Slot<any>[], get: (state: EditorState) => readonly Input[]) {
    if (this.isStatic) throw new Error("Can't derive a static facet")
    return new FacetProvider<Input>(deps, this, (state, output) => {
      for (let v of get(state)) output.push(v)
    })
  }

  static fallback(e: Extension): Extension { return new PrecExtension(e, P.Fallback) }
  static default(e: Extension): Extension { return new PrecExtension(e, P.Default) }
  static extend(e: Extension): Extension { return new PrecExtension(e, P.Extend) }
  static override(e: Extension): Extension { return new PrecExtension(e, P.Override) }
}

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a == b || a.length == b.length && a.every((e, i) => e === b[i])
}

type Slot<T> = Facet<any, T> | StateField<T>

/// Marks a value as an [`Extension`](#state.Extension).
declare const isExtension: unique symbol

class FacetProvider<Input> {
  constructor(readonly dependencies: readonly Slot<any>[],
              readonly facet: Facet<Input, any>,
              readonly get: (state: EditorState, gather: Input[]) => void) {}

  [isExtension]!: true
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
    private readonly updateF: (value: Value, tr: Transaction, state: EditorState) => Value,
    private compareF: (a: Value, b: Value) => boolean
  ) {}

  /// Define a state field.
  static define<Value>(config: StateFieldSpec<Value>): StateField<Value> {
    return new StateField<Value>(config.create, config.update,
                                 config.compare || ((a, b) => a === b))
  }

  /// @internal
  compute(state: EditorState, tr: Transaction | null) {
    if (tr) {
      let oldVal = getID(tr.startState, this.id), newVal = this.updateF(oldVal, tr, state)
      if (!this.compareF(oldVal, newVal)) setID(state, this.id, newVal)
      else setIDComputed(state, this.id)
    } else {
      setID(state, this.id, this.createF(state))
    }
  }

  [isExtension]!: true
}

export type Extension = {[isExtension]: true} | readonly Extension[]

class FacetInstance<Input> {
  dependencies: Slot<any>[] = []
  providers: FacetProvider<Input>[] = []

  constructor(readonly facet: Facet<Input, any>) {}

  recompute(state: EditorState) {
    let result: Input[] = []
    for (let p of this.providers) p.get(state, result)
    return this.facet.combine(result)
  }

  compute(state: EditorState, tr: Transaction | null) {
    if (tr) {
      if (this.dependencies.some(d => idHasChanged(state, d.id))) {
        let newVal = this.recompute(state)
        if (!this.facet.compare(newVal, getID(tr.startState, this.id))) {
          setID(state, this.id, newVal)
          return
        }
      }
      setIDComputed(state, this.id)
    } else {
      setID(state, this.id, this.recompute(state))
    }
  }

  get id() { return this.facet.id }
}

type SlotInstance = StateField<any> | FacetInstance<any>

const enum P { Override, Extend, Default, Fallback }

class PrecExtension {
  constructor(readonly e: Extension, readonly prec: P) {}
  [isExtension]!: true
}

export class Configuration {
  constructor(readonly dynamicSlots: SlotInstance[],
              readonly address: {[id: number]: number},
              readonly staticValues: readonly any[]) {}

  staticFacet<Output>(facet: Facet<any, Output>) {
    let addr = this.address[facet.id]
    return addr == null ? facet.default : this.staticValues[addr >> 1]
  }

  // Passing EditorState as argument to avoid cyclic dependency
  static resolve(extension: Extension, Ctor: typeof EditorState) {
    let facets: {[id: number]: FacetInstance<any>} = Object.create(null)
    let slots: SlotInstance[] = []

    for (let ext of flatten(extension)) {
      if (ext instanceof StateField) {
        slots.push(ext)
      } else {
        let inst = facets[ext.facet.id]
        if (!inst) slots.push(inst = facets[ext.facet.id] = new FacetInstance(ext.facet))
        inst.providers.push(ext)
        for (let dep of ext.dependencies) if (inst.dependencies.indexOf(dep) < 0) inst.dependencies.push(dep)
      }
    }

    function isStatic(slot: Slot<any>) {
      return slot instanceof Facet && facets[slot.id].dependencies.every(isStatic)
    }
    let address: {[id: number]: number} = Object.create(null), tempAddress: {[id: number]: number} = Object.create(null)
    let staticSlots: FacetInstance<any>[] = []
    let dynamicSlots: SlotInstance[] = []
    for (let slot of slots) {
      if (slot instanceof FacetInstance && isStatic(slot.facet)) {
        address[slot.facet.id] = 1 | (staticSlots.length << 1)
        tempAddress[slot.facet.id] = staticSlots.length << 1
        staticSlots.push(slot)
      } else {
        address[slot.id] = dynamicSlots.length << 1
        dynamicSlots.push(slot)
      }
    }

    let tempState = initState(new Ctor(new Configuration(staticSlots, tempAddress, none), Text.empty, EditorSelection.single(0)),
                              null)
    return new Configuration(dynamicSlots, address, tempState.values)
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
  Unknown = 0,
  Changed = 1,
  Computed = 2,
  Computing = 4
}

export function ensureID(state: EditorState, id: number): number | undefined {
  let addr = state.config.address[id]
  if (addr == null || (addr & 1)) return addr
  let idx = addr >> 1
  let status = state.status[idx]
  if (status == SlotStatus.Computing) throw new Error("Cyclic dependency between fields and/or facets")
  if ((status & SlotStatus.Computed) == 0) {
    state.status[idx] = SlotStatus.Computing
    state.config.dynamicSlots[idx].compute(state, state.applying)
  }
  return addr
}

function getID(state: EditorState, id: number) {
  return getAddr(state, ensureID(state, id)!)
}

export function getAddr(state: EditorState, addr: number) {
  return addr & 1 ? state.config.staticValues[addr >> 1] : state.values[addr >> 1]
}

function addrStatus(state: EditorState, addr: number) {
  return addr & 1 ? SlotStatus.Computed : state.status[addr >> 1]
}

function idHasChanged(state: EditorState, id: number) {
  let found = ensureID(state, id)
  return found == null ? false : (addrStatus(state, found) & SlotStatus.Changed) > 0
}

export function setID(state: EditorState, id: number, value: any) {
  let addr = state.config.address[id] >> 1
  state.values[addr] = value
  state.status[addr] = SlotStatus.Computed | SlotStatus.Changed
}

function setIDComputed(state: EditorState, id: number) {
  let addr = state.config.address[id] >> 1
  state.status[addr] = SlotStatus.Computed
}

export function initState(state: EditorState, tr: Transaction | null) {
  state.applying = tr
  for (let slot of state.config.dynamicSlots) ensureID(state, slot.id)
  state.applying = null
  return state
}
