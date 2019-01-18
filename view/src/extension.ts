import {EditorState, Transaction} from "../../state/src"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet, Decoration} from "./decoration"
import {Extension, Slot} from "../../extension/src/extension"
import {EditorView} from "./editorview"
import {Attrs} from "./attributes"

export const decorationSlot = Slot.define<(field: any) => DecorationSet>()

export class ViewField<V> {
  create: (fields: ViewFields) => V
  update: (value: V, update: ViewUpdate) => V
  slots: Slot<(field: V) => any>[]
  extension: ViewExtension
  
  constructor({create, update, slots = []}: {
    create: (fields: ViewFields) => V
    update: (value: V, update: ViewUpdate) => V,
    slots?: Slot<(field: V) => any>[]
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
      slots: [decorationSlot(d => d)]
    }).extension
  }

  static decorationSlot<T>(accessor: (field: T) => DecorationSet) { return decorationSlot(accessor) }

  // FIXME naming?
  static editorAttributes = Slot.define<(field: any) => (Attrs | null)>()
  static contentAttributes = Slot.define<(field: any) => (Attrs | null)>()
}

export class ViewExtension extends Extension {}

export const viewField = ViewExtension.defineBehavior<ViewField<any>>()

export const handleDOMEvents = ViewExtension.defineBehavior<{[key: string]: (view: EditorView, event: any) => boolean}>()

export type ViewPlugin = {
  update?: (update: ViewUpdate) => void
  destroy?: () => void
}

export const viewPlugin = ViewExtension.defineBehavior<(view: EditorView) => ViewPlugin>()

export const styleModule = ViewExtension.defineBehavior<StyleModule>()

export class ViewFields {
  private values: any[] = []

  private constructor(public state: EditorState,
                      public viewport: Viewport,
                      public focused: boolean,
                      private fields: ReadonlyArray<ViewField<any>>,
                      private view: EditorView) {}

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

  // You usually shouldn't do anything with the view object when
  // computing fields, and mutating it at that point is not allowed,
  // but there are several reasonable things you may want to do, such
  // as measure positions or get the default text size, that would
  // otherwise be very painful, so this method is provided as a way to
  // get at the view anyway. (FIXME not sure if this is a good idea)
  unsafeGetView(): EditorView { return this.view }

  getSlot<V>(type: (value: (field: any) => V) => Slot<(field: any) => V>) {
    let result: V[] = []
    for (let i = 0; i < this.values.length; i++) {
      let accessor = Slot.get(type, this.fields[i].slots)
      if (accessor) result.push(accessor(this.values[i]) as V)
    }
    return result
  }

  // @internal
  static create(fields: ReadonlyArray<ViewField<any>>, state: EditorState, viewport: Viewport, view: EditorView) {
    let set = new ViewFields(state, viewport, view.hasFocus(), fields, view)
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i]
      if (fields.indexOf(field, i + 1) > -1)
        throw new RangeError("Multiple instances of the same view field found")
      set.values.push(field.create(set))
    }
    return set
  }

  // @internal
  update(state: EditorState, viewport: Viewport, transactions: ReadonlyArray<Transaction>, slots: Slot[]) {
    let focusChanged = Slot.get(focusChange, slots)
    let set = new ViewFields(state, viewport, focusChanged == null ? this.focused : focusChanged, this.fields, this.view)
    let update = new ViewUpdate(transactions, this, set, slots)
    for (let i = 0; i < this.fields.length; i++)
      set.values.push(this.fields[i].update(this.values[i], update))
    return set
  }
}

export const focusChange = Slot.define<boolean>()

export class ViewUpdate {
  readonly new: ViewFields
  constructor(public readonly transactions: ReadonlyArray<Transaction>,
              public readonly old: ViewFields,
              public nw: ViewFields,
              private slots: Slot[]) {
    this.new = nw
  }

  get viewportChanged() {
    return this.old.viewport.eq(this.new.viewport)
  }

  get docChanged() {
    return this.transactions.some(tr => tr.docChanged)
  }

  getSlot<T>(type: (value: T) => Slot<T>): T | undefined {
    for (let i = this.transactions.length; i >= 0; i--) {
      let found = i == this.transactions.length ? Slot.get(type, this.slots) : this.transactions[i].getSlot(type)
      if (found !== undefined) return found
    }
    return undefined
  }
}
