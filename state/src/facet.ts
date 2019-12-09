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
  /// The facets and fields that this field's `create` and `update`
  /// methods read. It is important to specify all such inputs, so
  /// that the library can schedule the computation of fields and
  /// facets in the right order.
  dependencies?: readonly Slot<any>[]

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
    /// @internal
    readonly dependencies: readonly Slot<any>[],
    private createF: (state: EditorState) => Value,
    private readonly updateF: (value: Value, tr: Transaction, state: EditorState) => Value,
    private compareF: (a: Value, b: Value) => boolean
  ) {}

  /// Define a state field.
  static define<Value>(config: StateFieldSpec<Value>): StateField<Value> {
    return new StateField<Value>(config.dependencies || none,
                                 config.create, config.update,
                                 config.compare || ((a, b) => a === b))
  }

  /// @internal
  init(state: EditorState, prev?: EditorState) {
    state.setID(this.id, prev && prev.config.address[this.id] != null ? prev.getID(this.id) : this.createF(state))
  }

  /// @internal
  update(state: EditorState, prev: EditorState, tr: Transaction) {
    let oldVal = prev.getID(this.id), newVal = this.updateF(oldVal, tr, state)
    if (!this.compareF(oldVal, newVal)) state.setID(this.id, newVal)
  }

  [isExtension]!: true
}

export type Extension = {[isExtension]: true} | readonly Extension[]

class FacetInstance<Input> {
  dependencies: readonly Slot<any>[]

  constructor(readonly facet: Facet<Input, any>,
              readonly providers: readonly FacetProvider<Input>[]) {
    let deps = []
    for (let prov of providers) for (let dep of prov.dependencies)
      if (deps.indexOf(dep) < 0) deps.push(dep)
    this.dependencies = deps
  }

  recompute(state: EditorState) {
    let result: Input[] = []
    for (let p of this.providers) p.get(state, result)
    return this.facet.combine(result)
  }

  init(state: EditorState) {
    state.setID(this.id, this.recompute(state))
  }

  update(state: EditorState, prev: EditorState) {
    // FIXME make this more incremental, probably by storing individual provider's values
    if (this.dependencies.some(d => state.idHasChanged(d.id))) {
      let newVal = this.recompute(state)
      if (!this.facet.compare(newVal, prev.getID(this.id)))
        state.setID(this.id, newVal)
    }
  }

  get id() { return this.facet.id }
}

export type SlotInstance = StateField<any> | FacetInstance<any>

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

  // Passing `EditorState` as a value here to avoid a cyclic dependency issue
  static resolve(extension: Extension, Ctor: typeof EditorState) {
    let providers: {[id: number]: FacetProvider<any>[]} = Object.create(null)
    let slots: {[id: number]: {value: Slot<any>, deps: Slot<any>[], mark: number}} = Object.create(null)

    for (let ext of flatten(extension)) {
      if (ext instanceof StateField) {
        slots[ext.id] = {value: ext, deps: ext.dependencies as Slot<any>[], mark: 0}
      } else {
        let slot = slots[ext.facet.id] || (slots[ext.facet.id] = {value: ext.facet, deps: [], mark: 0})
        for (let dep of ext.dependencies) if (slot.deps.indexOf(dep) < 0) slot.deps.push(dep)
        ;(providers[ext.facet.id] || (providers[ext.facet.id] = [])).push(ext)
      }
    }

    let ordered: SlotInstance[] = []
    function visit(slot: {value: Slot<any>, deps: Slot<any>[], mark: number}) {
      if (slot.mark) {
        if (slot.mark == 1) throw new Error("Cyclic dependency in facets and fields")
        return
      }
      slot.mark = 1
      for (let dep of slot.deps) {
        let found = slots[dep.id]
        if (!found) {
          if (dep instanceof StateField) throw new Error("Dependency on unavailable field")
          continue
        }
        visit(found)
      }
      slot.mark = 2
      ordered.push(slot.value instanceof Facet ? new FacetInstance(slot.value, providers[slot.value.id]) : slot.value)
    }
    for (let id in slots) visit(slots[id])

    function isStatic(slot: Slot<any>) {
      return slot instanceof Facet && providers[slot.id].every(prov => prov.dependencies.every(isStatic))
    }
    let address: {[id: number]: number} = Object.create(null), tempAddress: {[id: number]: number} = Object.create(null)
    let staticSlots: FacetInstance<any>[] = []
    let dynamicSlots: SlotInstance[] = []
    for (let slot of ordered) {
      if (slot instanceof FacetInstance && isStatic(slot.facet)) {
        address[slot.facet.id] = 1 | (staticSlots.length << 1)
        tempAddress[slot.facet.id] = staticSlots.length << 1
        staticSlots.push(slot)
      } else {
        address[slot.id] = dynamicSlots.length << 1
        dynamicSlots.push(slot)
      }
    }

    let tempState = new Ctor(new Configuration(staticSlots, tempAddress, none), Text.empty, EditorSelection.single(0), [])
      .initSlots(staticSlots)
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
