import {Text} from "../../doc/src/text"

export interface StateFieldSpec<T> {
  readonly key: string;
  init(): T;
  apply(tr: Transaction, value: T, newState: EditorState, oldState: EditorState): T;
}

class Configuration {
  constructor(public readonly fields: StateFieldSpec<any>[] = []) {
  }

  static get default(): Configuration {
    return new Configuration()
  }
}

export interface EditorStateConfig {
  doc?: string | Text;
  selection?: Selection;
}

export class EditorState {
  /** internal */
  constructor(/** internal */ public readonly config: Configuration,
              public readonly doc: Text,
              public readonly selection: Selection = Selection.default,
              public readonly fields: {readonly [key: string]: any} = Object.create(null)) {}

  getField(key: string): any {
    return this.fields[key]
  }

  get transaction(): Transaction {
    return Transaction.start(this)
  }

  static create(config: EditorStateConfig = {}) {
    let doc = config.doc instanceof Text ? config.doc : Text.create(config.doc || "")
    let $config = Configuration.default // FIXME derive from plugins
    let fields = Object.create(null)
    for (let i = 0; i < $config.fields.length; i++) fields[$config.fields[i].key] = $config.fields[i].init()
    return new EditorState($config, doc, config.selection || Selection.default, fields)
  }
}

export class Range {
  constructor(public readonly anchor: number, public readonly head: number = anchor) {}

  get from(): number { return Math.min(this.anchor, this.head) }
  get to(): number { return Math.max(this.anchor, this.head) }
  get empty(): boolean { return this.anchor == this.head }

  map(change: Change): Range {
    let anchor = change.mapPos(this.anchor), head = change.mapPos(this.head)
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

  map(change: Change): Selection {
    return new Selection(this.ranges.map(r => r.map(change)))
  }

  eq(other: Selection): boolean {
    if (this.ranges.length != other.ranges.length) return false
    for (let i = 0; i < this.ranges.length; i++)
      if (!this.ranges[i].eq(other.ranges[i])) return false
    return true
  }

  get primary(): Range { return this.ranges[0] }

  static default: Selection = new Selection([new Range(0)]);
}

const empty: any[] = []

class Meta {
  constructor(from: Meta | null = null) {
    if (from) for (let prop in from) this[prop] = from[prop]
  }
  [key: string]: any;
}
Meta.prototype["__proto__"] = null

const FLAG_SELECTION_SET = 1, FLAG_SCROLL_INTO_VIEW = 2

export class Transaction {
  private constructor(public readonly startState: EditorState,
                      public readonly changes: ReadonlyArray<Change>,
                      public readonly docs: ReadonlyArray<Text>,
                      public readonly selection: Selection,
                      private readonly meta: Meta,
                      private readonly flags: number) {}

  static start(state: EditorState, time: number = Date.now()) {
    let meta = new Meta
    meta.time = time
    return new Transaction(state, empty, empty, state.selection, meta, 0)
  }

  get doc(): Text {
    let last = this.docs.length - 1
    return last < 0 ? this.startState.doc : this.docs[last]
  }

  setMeta(name: string, value: any) {
    let meta = new Meta(this.meta)
    meta[name] = value
    return new Transaction(this.startState, this.changes, this.docs, this.selection, meta, this.flags)
  }

  getMeta(name: string): any {
    return this.meta[name]
  }

  change(change: Change): Transaction {
    if (change.from == change.to && change.text == "") return this
    return new Transaction(this.startState,
                           this.changes.concat(change),
                           this.docs.concat(change.apply(this.doc)),
                           this.selection.map(change), this.meta, this.flags)
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
    for (let i = 0; i < sel.ranges.length; i++) {
      let range = sel.ranges[i]
      for (let j = start; j < tr.changes.length; j++)
        range = range.map(tr.changes[j])
      tr = f(tr, range)
    }
    return tr
  }

  setSelection(selection: Selection): Transaction {
    return new Transaction(this.startState, this.changes, this.docs, selection, this.meta, this.flags | FLAG_SELECTION_SET)
  }

  get selectionSet() {
    return (this.flags & FLAG_SELECTION_SET) > 0
  }

  scrollIntoView() {
    return new Transaction(this.startState, this.changes, this.docs, this.selection, this.meta, this.flags | FLAG_SCROLL_INTO_VIEW)
  }

  get scrolledIntoView() {
    return (this.flags & FLAG_SCROLL_INTO_VIEW) > 0
  }

  apply(): EditorState {
    let fields = Object.create(null), $conf = this.startState.config
    let newState = new EditorState($conf, this.doc, this.selection, fields)
    for (let i = 0; i < $conf.fields.length; i++) {
      let field = $conf.fields[i]
      fields[field.key] = field.apply(this, this.startState.fields[field.key], newState, this.startState)
    }
    return newState
  }
}

export class Change {
  constructor(public readonly from: number, public readonly to: number, public readonly text: string) {}

  invert(doc: Text): Change {
    return new Change(this.from, this.from + this.text.length, doc.slice(this.from, this.to))
  }

  mapPos(pos: number, bias: number = 1): number {
    if (pos < this.from || bias < 0 && pos == this.from) return pos
    if (pos > this.to) return pos + this.text.length - (this.to - this.from)
    let side = this.from == this.to ? bias : pos == this.from ? -1 : pos == this.to ? 1 : bias
    return this.from + (side < 0 ? 0 : this.text.length)
  }

  apply(doc: Text): Text {
    return doc.replace(this.from, this.to, this.text)
  }
}
