export enum Priority { fallback = -1, base = 0, extend = 1, override = 2 }

interface ResolveResult<Value> {
  value: Value,
  dependencies?: BehaviorSpec<any>[]
}

export class Behavior<Spec, Value = Spec[]> {
  private constructor(public name: string,
                      public resolve: (specs: Spec[]) => ResolveResult<Value>,
                      public dependencies: Behavior<any>[]) {}

  static simple<Value>(name: string) {
    return new Behavior<Value, Value[]>(name, x => ({value: x, dependencies: []}), [])
  }

  static define<Spec, Value>(name: string,
                             resolve: (specs: Spec[]) => ResolveResult<Value>,
                             dependencies: Behavior<any>[] = []) {
    return new Behavior<Spec, Value>(name, resolve, dependencies)
  }

  create(spec: Spec, priority: Priority = Priority.base): BehaviorSpec<Spec, Value> {
    return new BehaviorSpec(this, spec, priority)
  }

  // @internal
  dependsOn(behavior: Behavior<any>): boolean {
    return this.dependencies.some(dep => dep == behavior || dep.dependsOn(behavior))
  }

  get(set: BehaviorSet): Value | undefined {
    let found = set.behaviors.indexOf(this as any)
    return found > -1 ? set.values[found] as Value : undefined
  }

  some<Result>(
    set: BehaviorSet,
    f: (value: Value extends (infer ElementType)[] ? ElementType : never) => Result
  ): Result | undefined {
    let found = undefined, value = this.get(set)
    if (value === undefined) return found
    if (!Array.isArray(value)) throw new RangeError("Can't call some on a non-array behavior")
    for (let elt of value) {
      found = f(elt)
      if (found !== undefined) break
    }
    return found
  }
}

export class BehaviorSpec<Spec, Value = Spec[]> {
  constructor(public type: Behavior<Spec, Value>,
              public spec: Spec,
              public priority: Priority) {}
}

export class BehaviorSet {
  behaviors: Behavior<any>[] = []
  values: any[] = []

  static resolve(behaviors: BehaviorSpec<any>[]): BehaviorSet {
    let set = new BehaviorSet
    let pending = behaviors.slice()
    // This does a crude topological ordering to resolve behaviors
    // top-to-bottom in the dependency ordering. If there are no
    // cyclic dependencies, we can always find a behavior in the top
    // `pending` array that isn't a dependency of any unresolved
    // behavior, and thus find and order all its specs in order to
    // resolve them.
    while (pending.length > 0) {
      let top = findTopType(pending)
      let result = takeType(pending, top)
      set.behaviors.push(top)
      set.values.push(result.value)
      if (result.dependencies) for (let spec of result.dependencies) pending.push(spec)
    }
    return set
  }
}

function findTopType(behaviors: BehaviorSpec<any>[]): Behavior<any> {
  for (let behavior of behaviors)
    if (!behaviors.some(b => b.type.dependsOn(behavior.type)))
      return behavior.type
  throw new RangeError("Cyclic dependency in behavior " + behaviors[0].type.name)
}

function takeType<Spec, Value>(behaviors: BehaviorSpec<any>[], type: Behavior<Spec, Value>): ResolveResult<Value> {
  let specs: BehaviorSpec<Spec, Value>[] = []
  for (let i = 0; i < behaviors.length; i++) {
    let behavior = behaviors[i] as any as BehaviorSpec<Spec, Value>
    if (behavior.type == type) {
      behaviors.splice(i--, 1)
      let j = 0
      while (j < specs.length && specs[j].priority < behavior.priority) j++
      specs.splice(j, 0, behavior)
    }
  }
  return type.resolve(specs.map(s => s.spec))
}
