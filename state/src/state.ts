import {joinLines, splitLines, Text} from "../../doc/src"
import {EditorSelection} from "./selection"
import {Plugin, StateField} from "./plugin"
import {Transaction, MetaSlot} from "./transaction"

class Configuration {
  constructor(
    readonly plugins: ReadonlyArray<Plugin>,
    readonly fields: ReadonlyArray<StateField<any>>,
    readonly multipleSelections: boolean,
    readonly tabSize: number,
    readonly lineSeparator: string | null) {}

  static create(config: EditorStateConfig): Configuration {
    let plugins = config.plugins || [], fields = [], multiple = !!config.multipleSelections
    for (let plugin of plugins) {
      if (plugin.spec.multipleSelections) multiple = true
      let field = plugin.stateField
      if (!field) continue
      if (fields.indexOf(field) > -1)
        throw new Error(`A state field (${field.key}) can only be added to a state once`)
      fields.push(field)
    }
    return new Configuration(plugins, fields, multiple, config.tabSize || 4, config.lineSeparator || null)
  }

  updateTabSize(tabSize: number) {
    return new Configuration(this.plugins, this.fields, this.multipleSelections, tabSize, this.lineSeparator)
  }

  updateLineSeparator(lineSep: string | null) {
    return new Configuration(this.plugins, this.fields, this.multipleSelections, this.tabSize, lineSep)
  }
}

export interface EditorStateConfig {
  doc?: string | Text
  selection?: EditorSelection
  plugins?: ReadonlyArray<Plugin>
  tabSize?: number
  lineSeparator?: string | null
  multipleSelections?: boolean
}

export class EditorState {
  /** @internal */
  constructor(private readonly config: Configuration,
              readonly doc: Text,
              readonly selection: EditorSelection = EditorSelection.default) {}

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

  /** @internal */
  applyTransaction(tr: Transaction): EditorState {
    let $conf = this.config
    let tabSize = tr.getMeta(MetaSlot.changeTabSize), lineSep = tr.getMeta(MetaSlot.changeLineSeparator)
    if (tabSize !== undefined) $conf = $conf.updateTabSize(tabSize)
    // FIXME changing the line separator might involve rearranging line endings (?)
    if (lineSep !== undefined) $conf = $conf.updateLineSeparator(lineSep)
    let newState = new EditorState($conf, tr.doc, tr.selection)
    for (let field of $conf.fields)
      (newState as any)[field.key] = field.apply(tr, (this as any)[field.key], newState)
    return newState
  }

  get transaction(): Transaction {
    return Transaction.start(this)
  }

  get tabSize(): number { return this.config.tabSize }

  get multipleSelections(): boolean { return this.config.multipleSelections }

  joinLines(text: ReadonlyArray<string>): string { return joinLines(text, this.config.lineSeparator || undefined) }
  splitLines(text: string): string[] { return splitLines(text, this.config.lineSeparator || undefined) }

  static create(config: EditorStateConfig = {}): EditorState {
    let $config = Configuration.create(config)
    let doc = config.doc instanceof Text ? config.doc : Text.of(config.doc || "", config.lineSeparator || undefined)
    let selection = config.selection || EditorSelection.default
    if (!$config.multipleSelections) selection = selection.asSingle()
    let state = new EditorState($config, doc, selection)
    for (let field of $config.fields) (state as any)[field.key] = field.init(state)
    return state
  }
}
