import {EditorState, Transaction, ChangeSet} from "../../state/src"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet, Decoration} from "./decoration"
import {Extension, Slot, SlotType} from "../../extension/src/extension"
import {EditorView} from "./editorview"
import {Attrs} from "./attributes"

export type Effect<T> = SlotType<(field: any) => T>

const none: any[] = []

export class ViewField<V> {
  readonly create: (view: EditorView) => V
  readonly update: (value: V, update: ViewUpdate) => V
  readonly effects: Slot<(field: V) => any>[]
  
  constructor({create, update, effects = []}: {
    create: (view: EditorView) => V
    update: (value: V, update: ViewUpdate) => V,
    effects?: Slot<(field: V) => any>[]
  }) {
    this.create = create; this.update = update; this.effects = effects
  }

  get extension() { return viewField(this) }

  static decorationEffect = Slot.define<(field: any) => DecorationSet>()
  static editorAttributeEffect = Slot.define<(field: any) => (Attrs | null)>()
  static contentAttributeEffect = Slot.define<(field: any) => (Attrs | null)>()

  static decorations({create, update, map}: {
    create?: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    return new ViewField<DecorationSet>({
      create: create || (() => Decoration.none),
      update(deco: DecorationSet, u: ViewUpdate) {
        if (map) deco = deco.map(u.changes)
        return update(deco, u)
      },
      effects: [ViewField.decorationEffect(d => d)]
    }).extension
  }

  static editorAttributes = attributeField(ViewField.editorAttributeEffect)
  static contentAttributes = attributeField(ViewField.contentAttributeEffect)
}

function attributeField(effect: Effect<Attrs | null>) {
  return function(value: Attrs | ((view: EditorView) => Attrs | null),
                  update?: (value: Attrs | null, update: ViewUpdate) => Attrs | null) {
    return new ViewField<Attrs | null>({
      create: value instanceof Function ? value : () => value,
      update: update || (a => a), effects: [effect(a => a)]
    }).extension
  }
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

export const focusChange = Slot.define<boolean>()

export class ViewUpdate {
  readonly state: EditorState
  readonly changes: ChangeSet
  readonly prevState: EditorState
  // @internal
  readonly prevFields: ReadonlyArray<ViewField<any>>
  // @internal
  readonly prevFieldValues: ReadonlyArray<any>
  readonly prevViewport: Viewport

  constructor(readonly view: EditorView,
              readonly transactions: ReadonlyArray<Transaction> = none,
              // @internal
              readonly metadata: ReadonlyArray<Slot> = none) {
    this.state = transactions.length ? transactions[transactions.length - 1].apply() : view.state
    this.changes = transactions.reduce((chs, tr) => chs.appendSet(tr.changes), ChangeSet.empty)
    this.prevState = view.state
    this.prevFields = view.fields
    this.prevFieldValues = view.fieldValues
    this.prevViewport = view.viewport
  }

  get viewport() { return this.view.viewport }

  prevField<T>(field: ViewField<T>): T
  prevField<T, D = undefined>(field: ViewField<T>, defaultValue?: D): T | D {
    return getField(field, this.prevFields, this.prevFieldValues, defaultValue)
  }

  get viewportChanged() {
    return this.prevViewport.eq(this.view.viewport)
  }

  get docChanged() {
    return this.transactions.some(tr => tr.docChanged)
  }

  getMeta<T>(type: SlotType<T>): T | undefined {
    for (let i = this.transactions.length; i >= 0; i--) {
      let found = i == this.transactions.length ? Slot.get(type, this.metadata) : this.transactions[i].getMeta(type)
      if (found !== undefined) return found
    }
    return undefined
  }
}

export function getField<T, D = undefined>(field: ViewField<T>, fields: ReadonlyArray<ViewField<any>>,
                                           values: ReadonlyArray<any>, defaultValue?: D): T | D {
  let index = fields.indexOf(field)
  if (index < 0) {
    if (defaultValue === undefined) throw new RangeError("Field isn't present")
    else return defaultValue
  }
  if (index >= values.length) throw new RangeError("Accessing a field that isn't initialized yet")
  return values[index] as T
}
