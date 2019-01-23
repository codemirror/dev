import {EditorState, Transaction} from "../../state/src"
import {StyleModule} from "style-mod"
import {Viewport} from "./viewport"
import {DecorationSet, Decoration} from "./decoration"
import {Extension, Slot} from "../../extension/src/extension"
import {EditorView} from "./editorview"
import {Attrs} from "./attributes"

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

  static decorations({create, update, map}: {
    create?: (view: EditorView) => DecorationSet,
    update: (deco: DecorationSet, update: ViewUpdate) => DecorationSet,
    map?: boolean
  }) {
    return new ViewField<DecorationSet>({
      create: create || (() => Decoration.none),
      update(deco: DecorationSet, u: ViewUpdate) {
        if (map) for (let tr of u.transactions) deco = deco.map(tr.changes)
        return update(deco, u)
      },
      effects: [ViewField.decorationEffect(d => d)]
    }).extension
  }

  static decorationEffect = Slot.define<(field: any) => DecorationSet>()
  static editorAttributeEffect = Slot.define<(field: any) => (Attrs | null)>()
  static contentAttributeEffect = Slot.define<(field: any) => (Attrs | null)>()
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

export class ViewSnapshot {
  public state: EditorState
  public fields: ReadonlyArray<ViewField<any>>
  public fieldValues: ReadonlyArray<any>
  public viewport: Viewport
  constructor(view: EditorView) {
    this.state = view.state
    this.fields = view.fields
    this.fieldValues = view.fieldValues
    this.viewport = view.viewport
  }
}

export const focusChange = Slot.define<boolean>()

export class ViewUpdate {
  constructor(private prev: ViewSnapshot,
              public readonly transactions: ReadonlyArray<Transaction>,
              public readonly view: EditorView,
              private metadata: ReadonlyArray<Slot>) {}

  get prevState() { return this.prev.state }
  get state() { return this.view.state }
  get prevViewport() { return this.prev.viewport }
  get viewport() { return this.view.viewport }

  prevField<T>(field: ViewField<T>): T
  prevField<T, D = undefined>(field: ViewField<T>, defaultValue?: D): T | D {
    return getField(field, this.prev.fields, this.prev.fieldValues, defaultValue)
  }

  get viewportChanged() {
    return this.prev.viewport.eq(this.view.viewport)
  }

  get docChanged() {
    return this.transactions.some(tr => tr.docChanged)
  }

  getMeta<T>(type: (value: T) => Slot<T>): T | undefined {
    for (let i = this.transactions.length; i >= 0; i--) {
      let found = i == this.transactions.length ? Slot.get(type, this.metadata) : this.transactions[i].getSlot(type)
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
