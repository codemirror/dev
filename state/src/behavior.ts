import {EditorState, StateField} from "./state"

type A<T> = ReadonlyArray<T>

export enum Priority { fallback = -1, base = 0, extend = 1, override = 2 }

const noPriority = -2e9 as Priority

const none: A<any> = []

function noBehavior(): A<BehaviorSpec> { return none }

export class Behavior<Spec, Value> {
  private knownSub: Behavior<any, any>[] = []

  // @internal
  constructor(public name: string,
              /* @internal */ public compute: ((specs: A<Spec>) => Value) | null,
              /* @internal */ public behavior: (value: any) => A<BehaviorSpec>) {}

  toString() { return "[behavior " + name + "]" }

  static define<Spec, Value>(name: string,
                             compute: (specs: A<Spec>) => Value,
                             behavior: (value: any) => A<BehaviorSpec> = noBehavior) {
    return new Behavior<Spec, Value>(name, compute, behavior)
  }

  static defineSet<Spec>(name: string, behavior: (spec: Spec) => A<BehaviorSpec> = noBehavior) {
    return new SetBehavior<Spec>(name, null, behavior)
  }

  create(spec: Spec, priority: Priority = noPriority): BehaviorSpec {
    return new BehaviorSpec(this, spec, priority)
  }

  get(state: EditorState): Value | undefined {
    return state.config.behaviors.get(this)
  }

  static stateField: SetBehavior<StateField<any>>

  static multipleSelections = Behavior.define<boolean, boolean>(
    "multipleSelections", values => values.indexOf(true) > -1)

  // FIXME move to view?
  static viewPlugin: SetBehavior<(view: any) => any>

  // @internal
  hasSubBehavior(behavior: Behavior<any, any>): boolean {
    for (let sub of this.knownSub)
      if (sub == behavior || sub.hasSubBehavior(behavior)) return true
    return false
  }

  // @internal
  getBehavior(input: any, priority: Priority): A<BehaviorSpec> {
    let sub = this.behavior(input)
    for (let b of sub)
      if (this.knownSub.indexOf(b.type) < 0)
        this.knownSub.push(b.type)
    return sub.map(b => b.fillPriority(priority))
  }
}

export class SetBehavior<Spec> extends Behavior<Spec, A<Spec>> {
  get(state: EditorState): A<Spec> {
    return state.config.behaviors.get(this) || none
  }

  some<Result>(state: EditorState, f: (value: Spec) => Result): Result | undefined {
    for (let elt of this.get(state)) {
      let found = f(elt)
      if (found !== undefined) return found
    }
    return undefined
  }
}

Behavior.stateField = Behavior.defineSet<StateField<any>>("stateField")
Behavior.viewPlugin = Behavior.defineSet<(view: any) => any>("viewPlugin")

export class BehaviorSpec {
  constructor(public type: Behavior<any, any>,
              public spec: any,
              public priority: Priority) {}

  fillPriority(priority: Priority) {
    return this.priority == noPriority ? new BehaviorSpec(this.type, this.spec, priority) : this
  }
}

export class BehaviorStore {
  behaviors: Behavior<any, any>[] = []
  values: any[] = []

  get<Value>(behavior: Behavior<any, Value>): Value | undefined {
    let found = this.behaviors.indexOf(behavior)
    return found < 0 ? undefined : this.values[found] as Value
  }

  static resolve(behaviors: A<BehaviorSpec>): BehaviorStore {
    let set = new BehaviorStore
    let pending: BehaviorSpec[] = behaviors.slice().map(spec => spec.fillPriority(Priority.base))
    // This does a crude topological ordering to resolve behaviors
    // top-to-bottom in the dependency ordering. If there are no
    // cyclic dependencies, we can always find a behavior in the top
    // `pending` array that isn't a dependency of any unresolved
    // behavior, and thus find and order all its specs in order to
    // resolve them.
    while (pending.length > 0) {
      let top = findTopType(pending)
      // Prematurely evaluated a behavior type because of missing
      // sub-behavior information -- start over, in the assumption
      // that newly gathered information will make the next attempt
      // more successful.
      if (set.behaviors.indexOf(top) > -1) return this.resolve(behaviors)
      let value = takeType(pending, top)
      set.behaviors.push(top)
      set.values.push(value)
    }
    return set
  }
}

function findTopType(behaviors: BehaviorSpec[]): Behavior<any, any> {
  for (let behavior of behaviors)
    if (!behaviors.some(b => b.type.hasSubBehavior(behavior.type)))
      return behavior.type
  throw new RangeError("Cyclic sub-behavior in " + behaviors[0].type.name)
}

function takeType<Spec, Value>(behaviors: BehaviorSpec[],
                               type: Behavior<Spec, Value>): Value {
  let specs: BehaviorSpec[] = []
  for (let spec of behaviors) if (spec.type == type) {
    let i = 0
    while (i < specs.length && specs[i].priority < spec.priority) i++
    specs.splice(i, 0, spec)
  }
  if (type.compute) {
    let value = type.compute(specs.map(s => s.spec)), first = true
    for (let i = 0; i < behaviors.length; i++) if (behaviors[i].type == type) {
      let sub = first ? type.getBehavior(value, behaviors[i].priority) : none
      behaviors.splice(i, 1, ...sub)
      first = false
      i += sub.length - 1
    }
    return value
  } else {
    for (let i = 0; i < behaviors.length; i++) if (behaviors[i].type == type) {
      let sub = type.getBehavior(behaviors[i].spec, behaviors[i].priority)
      behaviors.splice(i, 1, ...sub)
      i += sub.length - 1
    }
    return specs.map(s => s.spec) as any as Value
  }
}
