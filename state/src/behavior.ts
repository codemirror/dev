import {EditorState, StateField} from "./state"

type A<T> = ReadonlyArray<T>

export enum Priority { fallback = -1, base = 0, extend = 1, override = 2 }

const noPriority = -2e9 as Priority

const none: A<any> = []

function noBehavior(): A<BehaviorUse> { return none }

const noDefault: any = {}

export class Behavior<Spec, Value = Spec> {
  private knownSub: Behavior<any>[] = []

  // @internal
  constructor(/* @internal */ public combine: ((specs: A<Spec>) => Value) | null,
              /* @internal */ public behavior: (value: any) => A<BehaviorUse>,
              private default_: Spec) {}

  static define<Spec, Value = Spec>({combine, behavior = noBehavior, default: default_ = noDefault}: {
    combine: (specs: A<Spec>) => Value,
    behavior?: (value: any) => A<BehaviorUse>,
    default?: Spec
  }) {
    return new Behavior<Spec, Value>(combine, behavior, default_)
  }

  static defineSet<Spec>({behavior = noBehavior, default: default_ = noDefault}: {
    behavior?: (spec: Spec) => A<BehaviorUse>,
    default?: Spec
  } = {}) {
    return new SetBehavior<Spec>(null, behavior, default_)
  }

  use(spec: Spec = this.default_, priority: Priority = noPriority): BehaviorUse<Spec> {
    if (spec == noDefault) throw new RangeError("This behavior has no default spec")
    return new BehaviorUse(this, spec, priority)
  }

  get(state: EditorState): Value | undefined {
    return state.config.behavior.get(this)
  }

  static stateField: SetBehavior<StateField<any>>

  static multipleSelections = Behavior.define<boolean, boolean>({
    combine: values => values.indexOf(true) > -1,
    default: true
  })

  // FIXME move to view?
  static viewPlugin: SetBehavior<(view: any) => any>

  static indentation: SetBehavior<(state: EditorState, pos: number) => number>

  // @internal
  hasSubBehavior(behavior: Behavior<any>): boolean {
    for (let sub of this.knownSub)
      if (sub == behavior || sub.hasSubBehavior(behavior)) return true
    return false
  }

  // @internal
  getBehavior(input: any, priority: Priority): A<BehaviorUse> {
    let sub = this.behavior(input)
    for (let b of sub)
      if (this.knownSub.indexOf(b.type) < 0)
        this.knownSub.push(b.type)
    return sub.map(b => b.fillPriority(priority))
  }

  // Utility function for combining behaviors to fill in a config
  // object from an array of provided configs. Will, by default, error
  // when a field gets two values that aren't ===-equal, but you can
  // provide combine functions per field to do something else.
  static combineConfigs<Config>(configs: A<Config>,
                                combine: {[key: string]: (first: any, second: any) => any} = {},
                                defaults?: Config): Config {
    let result: any = {}
    for (let config of configs) for (let key of Object.keys(config)) {
      let value = (config as any)[key], current = result[key]
      if (current === undefined) result[key] = value
      else if (current === value || value === undefined) {} // No conflict
      else if (Object.hasOwnProperty.call(combine, key)) result[key] = combine[key](current, value)
      else throw new Error("Config merge conflict for field " + key)
    }
    if (defaults) for (let key in defaults)
      if (result[key] === undefined) result[key] = (defaults as any)[key]
    return result
  }
}

export class SetBehavior<Spec> extends Behavior<Spec, A<Spec>> {
  get(state: EditorState): A<Spec> {
    return state.config.behavior.get(this) || none
  }
}

Behavior.stateField = Behavior.defineSet()
Behavior.viewPlugin = Behavior.defineSet()
Behavior.indentation = Behavior.defineSet()

export class BehaviorUse<Spec = any> {
  constructor(public type: Behavior<Spec, any>,
              public spec: Spec,
              public priority: Priority) {}

  fillPriority(priority: Priority): BehaviorUse<Spec> {
    return this.priority == noPriority ? new BehaviorUse(this.type, this.spec, priority) : this
  }
}

export class BehaviorStore {
  behaviors: Behavior<any>[] = []
  values: any[] = []

  get<Value>(behavior: Behavior<any, Value>): Value | undefined {
    let found = this.behaviors.indexOf(behavior)
    return found < 0 ? undefined : this.values[found] as Value
  }

  static resolve(behaviors: A<BehaviorUse>): BehaviorStore {
    let set = new BehaviorStore
    let pending: BehaviorUse[] = behaviors.slice().map(spec => spec.fillPriority(Priority.base))
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

function findTopType(behaviors: BehaviorUse[]): Behavior<any> {
  for (let behavior of behaviors)
    if (!behaviors.some(b => b.type.hasSubBehavior(behavior.type)))
      return behavior.type
  throw new RangeError("Sub-behavior cycle in behaviors")
}

function takeType<Spec, Value>(behaviors: BehaviorUse[],
                               type: Behavior<Spec, Value>): Value {
  let specs: BehaviorUse<Spec>[] = []
  for (let spec of behaviors) if (spec.type == type) {
    let i = 0
    while (i < specs.length && specs[i].priority >= spec.priority) i++
    specs.splice(i, 0, spec)
  }
  if (type.combine) {
    let value = type.combine(specs.map(s => s.spec)), first = true
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
