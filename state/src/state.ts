import {Text} from "../../doc/src/text"

function unique(prefix: string, names: {[key: string]: string}): string {
  for (let i = 0;; i++) {
    let name = prefix + (i ? "_" + i : "")
    if (!(name in names)) return names[name] = name
  }
}

export interface Mapping {
  mapPos(pos: number, bias?: number, trackDel?: boolean): number
  length: number
}

const fieldNames = Object.create(null)

export class StateField<T> {
  /** @internal */
  readonly key: string;
  readonly init: (state: EditorState) => T;
  readonly apply: (tr: Transaction, value: T, newState: EditorState) => T;

  constructor({init, apply, debugName = "field"}: {
    init: (state: EditorState) => T,
    apply: (tr: Transaction, value: T, newState: EditorState) => T,
    debugName?: string
  }) {
    this.init = init
    this.apply = apply
    this.key = unique("$" + debugName, fieldNames)
  }
}

export interface PluginSpec {
  state?: StateField<any>;
  config?: any;
  props?: any;
}

export class Plugin {
  readonly config: any;
  readonly stateField: StateField<any> | null;
  readonly props: any;

  constructor(spec: PluginSpec) {
    this.config = spec.config
    this.stateField = spec.state || null
    this.props = spec.props || {}
  }
}

class Configuration {
  readonly fields: ReadonlyArray<StateField<any>>;

  constructor(readonly plugins: ReadonlyArray<Plugin>) {
    let fields = []
    for (let plugin of plugins) {
      let field = plugin.stateField
      if (!field) continue
      if (fields.indexOf(field) > -1)
        throw new Error(`A state field (${field.key}) can only be added to a state once`)
      fields.push(field)
    }
    this.fields = fields
  }
}

export interface EditorStateConfig {
  doc?: string | Text;
  selection?: Selection;
  plugins?: ReadonlyArray<Plugin>;
}

export class EditorState {
  /** @internal */
  constructor(/** @internal */ public readonly config: Configuration,
              public readonly doc: Text,
              public readonly selection: Selection = Selection.default) {}

  getField<T>(field: StateField<T>): T | undefined {
    return (this as any)[field.key]
  }

  get plugins(): ReadonlyArray<Plugin> { return this.config.plugins }

  getPluginWithField(field: StateField<any>): Plugin {
    for (const plugin of this.config.plugins) {
      if (plugin.stateField == field) return plugin
    }
    throw new Error("Plugin for field not configured")
  }

  get transaction(): Transaction {
    return Transaction.start(this)
  }

  static create(config: EditorStateConfig = {}): EditorState {
    let doc = config.doc instanceof Text ? config.doc : Text.create(config.doc || "")
    let $config = new Configuration(config.plugins || [])
    let state = new EditorState($config, doc, config.selection || Selection.default)
    for (let field of $config.fields) (state as any)[field.key] = field.init(state)
    return state
  }
}

export class Range {
  constructor(public readonly anchor: number, public readonly head: number = anchor) {}

  get from(): number { return Math.min(this.anchor, this.head) }
  get to(): number { return Math.max(this.anchor, this.head) }
  get empty(): boolean { return this.anchor == this.head }

  map(mapping: Mapping): Range {
    let anchor = mapping.mapPos(this.anchor), head = mapping.mapPos(this.head)
    if (anchor == this.anchor && head == this.head) return this
    else return new Range(anchor, head)
  }

  eq(other: Range): boolean {
    return this.anchor == other.anchor && this.head == other.head
  }
}

// FIXME remove/join on overlap, maybe sort, store primary index
// FIXME maybe rename to avoid name clash with DOM Selection type?
export class Selection {
  constructor(public readonly ranges: ReadonlyArray<Range>) {}

  map(mapping: Mapping): Selection {
    return new Selection(this.ranges.map(r => r.map(mapping)))
  }

  eq(other: Selection): boolean {
    if (this.ranges.length != other.ranges.length) return false
    for (let i = 0; i < this.ranges.length; i++)
      if (!this.ranges[i].eq(other.ranges[i])) return false
    return true
  }

  get primary(): Range { return this.ranges[0] }

  static single(anchor: number, head: number = anchor) {
    return new Selection([new Range(anchor, head)])
  }

  static default: Selection = Selection.single(0);
}

const empty: ReadonlyArray<any> = []

class Meta {
  constructor(from: Meta | null = null) {
    if (from) for (let prop in from) this[prop] = from[prop]
  }
  [key: string]: any;
}
Meta.prototype["__proto__"] = null

const metaSlotNames = Object.create(null)

export class MetaSlot<T> {
  /** @internal */
  name: string;

  constructor(debugName: string = "meta") {
    this.name = unique(debugName, metaSlotNames)
  }

  static time: MetaSlot<number> = new MetaSlot("time");
  static origin: MetaSlot<string> = new MetaSlot("origin")
  static userEvent: MetaSlot<string> = new MetaSlot("userEvent")
  static addToHistory: MetaSlot<boolean> = new MetaSlot("addToHistory")
  static rebased: MetaSlot<number> = new MetaSlot("rebased")
}

export class ChangeSet implements Mapping {
  constructor(readonly changes: ReadonlyArray<Change>,
              readonly mirror: ReadonlyArray<number> = empty) {}

  get length(): number {
    return this.changes.length
  }

  getMirror(n: number): number | null {
    for (let i = 0; i < this.mirror.length; i++)
      if (this.mirror[i] == n) return this.mirror[i + (i % 2 ? -1 : 1)]
    return null
  }

  append(change: Change, mirror?: number): ChangeSet {
    return new ChangeSet(this.changes.concat(change),
                         mirror != null ? this.mirror.concat(this.length, mirror) : this.mirror)
  }

  static empty: ChangeSet = new ChangeSet(empty)

  mapPos(pos: number, bias: number = 1, trackDel: boolean = false): number {
    return this.mapInner(pos, bias, trackDel, 0, this.length)
  }

  /** @internal */
  mapInner(pos: number, bias: number = 1, trackDel: boolean, fromI: number, toI: number): number {
    let dir = toI < fromI ? -1 : 1
    let recoverables: {[key: number]: number} | null = null
    let hasMirrors = this.mirror.length > 0, rec, mirror
    for (let i = fromI - (dir < 0 ? 1 : 0), endI = toI - (dir < 0 ? 1 : 0); i != endI; i += dir) {
      let {from, to, text: {length}} = this.changes[i]
      if (dir < 0) {
        let len = to - from
        to = from + length
        length = len
      }

      if (pos < from) continue
      if (pos > to) {
        pos += length - (to - from)
        continue
      }
      // Change touches this position
      if (recoverables && (rec = recoverables[i]) != null) { // There's a recovery for this change, and it applies
        pos = from + rec
        continue
      }
      if (hasMirrors && (mirror = this.getMirror(i)) != null &&
          (dir > 0 ? mirror > i && mirror < toI : mirror < i && mirror >= toI)) { // A mirror exists
        if (pos > from && pos < to) { // If this change deletes the position, skip forward to the mirror
          i = mirror
          pos = this.changes[i].from + (pos - from)
          continue
        }
        // Else store a recoverable
        ;(recoverables || (recoverables = {}))[mirror] = pos - from
      }
      if (pos > from && pos < to) {
        if (trackDel) return -1
        pos = bias < 0 ? from : from + length
      } else {
        pos = (from == to ? bias < 0 : pos == from) ? from : from + length
      }
    }
    return pos
  }

  partialMapping(from: number, to: number = this.length): Mapping {
    if (from == 0 && to == this.length) return this
    return new PartialMapping(this, from, to)
  }
}

class PartialMapping implements Mapping {
  constructor(readonly changes: ChangeSet, readonly from: number, readonly to: number) {}
  mapPos(pos: number, bias: number = 1, trackDel: boolean = false): number {
    return this.changes.mapInner(pos, bias, trackDel, this.from, this.to)
  }
  get length() { return Math.abs(this.to - this.from) }
}
    
const FLAG_SELECTION_SET = 1, FLAG_SCROLL_INTO_VIEW = 2

export class Transaction {
  private constructor(readonly startState: EditorState,
                      readonly changes: ChangeSet,
                      readonly docs: ReadonlyArray<Text>,
                      readonly selection: Selection,
                      private readonly meta: Meta,
                      private readonly flags: number) {}

  static start(state: EditorState, time: number = Date.now()) {
    let meta = new Meta
    meta[MetaSlot.time.name] = time
    return new Transaction(state, ChangeSet.empty, empty, state.selection, meta, 0)
  }

  get doc(): Text {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  setMeta<T>(slot: MetaSlot<T>, value: T): Transaction {
    let meta = new Meta(this.meta)
    meta[slot.name] = value
    return new Transaction(this.startState, this.changes, this.docs, this.selection, meta, this.flags)
  }

  getMeta<T>(slot: MetaSlot<T>): T | undefined {
    return this.meta[slot.name] as T
  }

  change(change: Change, mirror?: number): Transaction {
    if (change.from == change.to && change.text == "") return this
    let changes = this.changes.append(change, mirror)
    return new Transaction(this.startState, changes, this.docs.concat(change.apply(this.doc)),
                           this.selection.map(changes.partialMapping(changes.length - 1)),
                           this.meta, this.flags)
  }

  replace(from: number, to: number, text: string): Transaction {
    return this.change(new Change(from, to, text))
  }

  replaceSelection(text: string): Transaction {
    return this.reduceRanges((state, r) => {
      return state.change(new Change(r.from, r.to, text))
    })
  }

  reduceRanges(f: (transaction: Transaction, range: Range) => Transaction): Transaction {
    let tr: Transaction = this
    let sel = tr.selection, start = tr.changes.length
    for (let range of sel.ranges) {
      range = range.map(tr.changes.partialMapping(start))
      tr = f(tr, range)
    }
    return tr
  }

  setSelection(selection: Selection): Transaction {
    return new Transaction(this.startState, this.changes, this.docs, selection, this.meta,
                           this.flags | FLAG_SELECTION_SET)
  }

  get selectionSet() {
    return (this.flags & FLAG_SELECTION_SET) > 0
  }

  get docChanged(): boolean {
    return this.changes.length > 0
  }

  scrollIntoView() {
    return new Transaction(this.startState, this.changes, this.docs, this.selection,
                           this.meta, this.flags | FLAG_SCROLL_INTO_VIEW)
  }

  get scrolledIntoView() {
    return (this.flags & FLAG_SCROLL_INTO_VIEW) > 0
  }

  apply(): EditorState {
    let $conf = this.startState.config
    let newState = new EditorState($conf, this.doc, this.selection)
    for (let field of $conf.fields)
      (newState as any)[field.key] = field.apply(this, (this.startState as any)[field.key], newState)
    return newState
  }
}

export class Change {
  constructor(public readonly from: number, public readonly to: number, public readonly text: string) {}

  invert(doc: Text): Change {
    return new Change(this.from, this.from + this.text.length, doc.slice(this.from, this.to))
  }

  apply(doc: Text): Text {
    return doc.replace(this.from, this.to, this.text)
  }
}
