import {EditorState, Transaction} from "../../state/src"
import {Viewport} from "./viewport"
import {DecorationSet, Decoration} from "./decoration"
import {Extension} from "../../extension/src/extension"

export class ViewSlot<S> {
  private constructor(/* @internal */ public type: any,
                      /* @internal */ public accessor: (state: S) => any) {}

  static define<V>() {
    let type = {}
    return {
      slot<S>(accessor: (state: S) => V): ViewSlot<S> {
        return new ViewSlot<S>(type, accessor)
      },
      get(fields: ViewFields) {
        return fields.getSlot<V>(type)
      }
    }
  }
}

export const decorationSlot = ViewSlot.define<DecorationSet>()

export class ViewField<V> {
  create: (fields: ViewFields) => V
  update: (value: V, update: ViewUpdate) => V
  slots: ViewSlot<V>[]
  extension: ViewExtension
  
  constructor({create, update, slots = []}: {
    create: (fields: ViewFields) => V
    update: (value: V, update: ViewUpdate) => V,
    slots?: ViewSlot<V>[]
  }) {
    this.create = create; this.update = update; this.slots = slots
    this.extension = viewField(this)
  }

  static decorations({create, update, map}: {
    create?: (fields: ViewFields) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    return new ViewField<DecorationSet>({
      create: create || (() => Decoration.none),
      update(deco: DecorationSet, u: ViewUpdate) {
        if (map) for (let tr of u.transactions) deco = deco.map(tr.changes)
        return update(deco, u)
      },
      slots: [decorationSlot.slot(d => d)]
    }).extension
  }

  static decorationSlot = decorationSlot.slot
}

export class ViewExtension extends Extension {}

export const viewField = ViewExtension.defineBehavior<ViewField<any>>()

export class ViewFields {
  private values: any[] = []

  constructor(public state: EditorState,
              public viewport: Viewport,
              private fields: ReadonlyArray<ViewField<any>>) {}

  get<T, D>(field: ViewField<T>, defaultValue: D): T | D;
  get<T>(field: ViewField<T>): T;

  get<T, D = undefined>(field: ViewField<T>, defaultValue?: D): T | D {
    let index = this.fields.indexOf(field)
    if (index < 0) {
      if (defaultValue === undefined) throw new RangeError("Field isn't present")
      else return defaultValue
    }
    if (index >= this.values.length) throw new RangeError("Accessing a field that isn't initialized yet")
    return this.values[index] as T
  }

  // @internal
  getSlot<V>(type: any) {
    let result: V[] = []
    for (let i = 0; i < this.values.length; i++) {
      for (let slot of this.fields[i].slots)
        if (slot.type == type) result.push(slot.accessor(this.values[i]) as V)
    }
    return result
  }

  // @internal
  static create(fields: ReadonlyArray<ViewField<any>>, state: EditorState, viewport: Viewport) {
    let set = new ViewFields(state, viewport, fields)
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i]
      if (fields.indexOf(field, i + 1) > -1)
        throw new RangeError("Multiple instances of the same view field found")
      set.values.push(field.create(set))
    }
    return set
  }

  // @internal
  update(state: EditorState, viewport: Viewport, transactions: ReadonlyArray<Transaction>) {
    let set = new ViewFields(state, viewport, this.fields)
    let update = new ViewUpdate(transactions, this, set)
    for (let i = 0; i < this.fields.length; i++)
      set.values.push(this.fields[i].update(this.values[i], update))
    return set
  }
}

export class ViewUpdate {
  readonly new: ViewFields
  constructor(public readonly transactions: ReadonlyArray<Transaction>,
              public readonly old: ViewFields,
              public nw: ViewFields) {
    this.new = nw // Work around TypeScript getting confused by 'public readonly new'
  }

  get viewportChanged() {
    return this.old.viewport.eq(this.new.viewport)
  }
}
