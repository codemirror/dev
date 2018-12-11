import {joinLines, splitLines, Text} from "../../doc/src"
import {EditorSelection} from "./selection"
import {BehaviorSet, Behavior, BehaviorSpec} from "./behavior"
import {Transaction, MetaSlot} from "./transaction"

class Configuration {
  constructor(
    readonly behaviors: BehaviorSet,
    readonly fields: ReadonlyArray<StateField<any>>,
    readonly multipleSelections: boolean,
    readonly tabSize: number,
    readonly lineSeparator: string | null) {}

  static create(config: EditorStateConfig): Configuration {
    let behaviors = BehaviorSet.resolve(config.behaviors || [])
    return new Configuration(
      behaviors,
      Behavior.stateField.getFromSet(behaviors) || [],
      !!Behavior.multipleSelections.getFromSet(behaviors),
      config.tabSize || 4,
      config.lineSeparator || null)
  }

  updateTabSize(tabSize: number) {
    return new Configuration(this.behaviors, this.fields, this.multipleSelections, tabSize, this.lineSeparator)
  }

  updateLineSeparator(lineSep: string | null) {
    return new Configuration(this.behaviors, this.fields, this.multipleSelections, this.tabSize, lineSep)
  }
}

export interface EditorStateConfig {
  doc?: string | Text
  selection?: EditorSelection
  behaviors?: ReadonlyArray<BehaviorSpec<any>>
  tabSize?: number
  lineSeparator?: string | null
}

export class EditorState {
  /** @internal */
  constructor(/* @internal */ readonly config: Configuration,
              private readonly fields: ReadonlyArray<any>,
              readonly doc: Text,
              readonly selection: EditorSelection) {
    for (let range of selection.ranges)
      if (range.to > doc.length) throw new RangeError("Selection points outside of document")
  }

  getField<T>(field: StateField<T>): T {
    let index = this.config.fields.indexOf(field)
    if (index < 0) throw new RangeError("Field " + field.name + " is not present in this state")
    return this.fields[index]
  }

  /** @internal */
  applyTransaction(tr: Transaction): EditorState {
    let $conf = this.config
    let tabSize = tr.getMeta(MetaSlot.changeTabSize), lineSep = tr.getMeta(MetaSlot.changeLineSeparator)
    if (tabSize !== undefined) $conf = $conf.updateTabSize(tabSize)
    // FIXME changing the line separator might involve rearranging line endings (?)
    if (lineSep !== undefined) $conf = $conf.updateLineSeparator(lineSep)
    let fields: any[] = []
    let newState = new EditorState($conf, fields, tr.doc, tr.selection)
    for (let i = 0; i < this.fields.length; i++)
      fields[i] = $conf.fields[i].apply(tr, this.fields[i], newState)
    return newState
  }

  get transaction(): Transaction {
    return Transaction.start(this)
  }

  get tabSize(): number { return this.config.tabSize }

  get multipleSelections(): boolean { return this.config.multipleSelections }

  joinLines(text: ReadonlyArray<string>): string { return joinLines(text, this.config.lineSeparator || undefined) }
  splitLines(text: string): string[] { return splitLines(text, this.config.lineSeparator || undefined) }

  // FIXME plugin state serialization

  toJSON(): any {
    return {
      doc: this.joinLines(this.doc.sliceLines(0, this.doc.length)),
      selection: this.selection.toJSON(),
      lineSeparator: this.config.lineSeparator,
      tabSize: this.tabSize
    }
  }

  static fromJSON(json: any, config: EditorStateConfig = {}): EditorState {
    if (!json || (json.lineSeparator && typeof json.lineSeparator != "string") ||
        typeof json.tabSize != "number" || typeof json.doc != "string")
      throw new RangeError("Invalid JSON representation for EditorState")
    return EditorState.create({
      doc: json.doc,
      selection: EditorSelection.fromJSON(json.selection),
      behaviors: config.behaviors,
      tabSize: config.tabSize,
      lineSeparator: config.lineSeparator
    })
  }

  static create(config: EditorStateConfig = {}): EditorState {
    let $config = Configuration.create(config)
    let doc = config.doc instanceof Text ? config.doc
      : Text.of(config.doc || "", config.lineSeparator || undefined)
    let selection = config.selection || EditorSelection.default
    if (!$config.multipleSelections) selection = selection.asSingle()
    let fields: any[] = []
    let state = new EditorState($config, fields, doc, selection)
    for (let field of $config.fields) fields.push(field.init(state))
    return state
  }
}

export class StateField<T> {
  readonly init: (state: EditorState) => T
  readonly apply: (tr: Transaction, value: T, newState: EditorState) => T
  readonly name: string

  constructor({init, apply, name = "stateField"}: {
    init: (state: EditorState) => T,
    apply: (tr: Transaction, value: T, newState: EditorState) => T,
    name?: string
  }) {
    this.init = init
    this.apply = apply
    this.name = unique(name, fieldNames)
  }
}

const fieldNames = Object.create(null)

export function unique(prefix: string, names: {[key: string]: string}): string {
  for (let i = 0;; i++) {
    let name = prefix + (i ? "_" + i : "")
    if (!(name in names)) return names[name] = name
  }
}
